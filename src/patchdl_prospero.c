/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Knutwurst
 *
 * PatchDL is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version. See the LICENSE file in the project root for details.
 */

#include "patchdl_prospero.h"
#include "patchdl_net.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define PROSPERO_BASE "https://prosperopatches.com"
#define PROSPERO_API  PROSPERO_BASE "/api/internal"
#define BUF_MAX       (512 * 1024)

/* Prospero firmware strings use the same hex-digits-as-decimal encoding
   as Sony's system_ver: "10.20.00.06" packs to 0x10200006.  Parse with
   %x so the hex bytes compare correctly against g_fw.bin. */
static uint32_t
fw_str_to_bin(const char *s) {
    unsigned a = 0, b = 0, c = 0, d = 0;
    sscanf(s, "%x.%x.%x.%x", &a, &b, &c, &d);
    return (a << 24) | (b << 16) | (c << 8) | d;
}

static void
fw_bin_to_display(uint32_t bin, char *out, size_t sz) {
    snprintf(out, sz, "%x.%02x", (bin >> 24) & 0xff, (bin >> 16) & 0xff);
}

/* Extract the first occurrence of `data-key="<hex>"` from HTML. */
static int
extract_data_key(const char *html, char *out, size_t out_sz) {
    const char *needle = "data-key=\"";
    const char *p = strstr(html, needle);
    if (!p) return -1;
    p += strlen(needle);
    size_t len = 0;
    while (p[len] && p[len] != '"' && len < out_sz - 1)
        len++;
    if (!len || p[len] != '"') return -1;
    memcpy(out, p, len);
    out[len] = '\0';
    return 0;
}

/* Find the next JSON string value for a given key inside a JSON object
   fragment.  Crude but sufficient for the predictable Prospero response. */
static const char *
json_str_val(const char *json, const char *key, char *out, size_t out_sz) {
    char needle[64];
    snprintf(needle, sizeof(needle), "\"%s\"", key);
    const char *p = strstr(json, needle);
    if (!p) return NULL;
    p += strlen(needle);
    while (*p == ' ' || *p == ':') p++;
    if (*p != '"') return NULL;
    p++;
    size_t len = 0;
    while (p[len] && p[len] != '"' && len < out_sz - 1)
        len++;
    memcpy(out, p, len);
    out[len] = '\0';
    return p + len + 1;
}

/* Check if a JSON fragment contains "success":true */
static int
json_success(const char *json) {
    const char *p = strstr(json, "\"success\"");
    if (!p) return 0;
    p += 9;
    while (*p == ' ' || *p == ':') p++;
    return !strncmp(p, "true", 4);
}

/* PS5 titles live on Prospero Patches, PS4 titles on its sister site Orbis
   Patches; both serve the same page and API. */
const char *
patchdl_patchsite_base(const char *title_id) {
    return (title_id && !strncmp(title_id, "CUSA", 4))
        ? "https://orbispatches.com" : PROSPERO_BASE;
}

/* The API key on the title page: Prospero puts it in data-key="<hex>",
   Orbis in data-loadparams="{ 'titleid': ..., 'key': '<hex>' }". */
static int
extract_key(const char *html, char *out, size_t out_sz) {
    const char *p;
    size_t      len = 0;

    if (!extract_data_key(html, out, out_sz)) return 0;
    if (!(p = strstr(html, "'key': '"))) return -1;
    p += strlen("'key': '");
    while (isxdigit((unsigned char)p[len]) && len < out_sz - 1) len++;
    if (!len || p[len] != '\'') return -1;
    memcpy(out, p, len);
    out[len] = '\0';
    return 0;
}

int
patchdl_patchsite_versions(const char *title_id, patchdl_patch_version_t *out,
                           int max, int *count) {
    patchdl_buf_t buf;
    char          url[256], key[128], body[256];
    const char   *base = patchdl_patchsite_base(title_id);
    const char   *cur, *next;
    int           n = 0;

    *count = 0;
    if (!title_id || !out || max <= 0) return -1;

    /* Step 1: fetch the title page for the API key. */
    memset(&buf, 0, sizeof(buf));
    buf.max = BUF_MAX;
    snprintf(url, sizeof(url), "%s/%.16s", base, title_id);
    if (patchdl_http_get_external(url, &buf)) return -1;
    if (!buf.data) return -1;
    if (extract_key(buf.data, key, sizeof(key))) {
        free(buf.data);
        return -1;
    }
    free(buf.data);

    /* Step 2: POST loadpatches. The API expects JSON in the body but
       application/x-www-form-urlencoded as Content-Type — this is how
       the website and every known third-party client calls it. */
    snprintf(body, sizeof(body),
             "{\"titleid\":\"%.16s\",\"key\":\"%s\"}", title_id, key);
    snprintf(url, sizeof(url), "%s/api/internal/loadpatches", base);
    memset(&buf, 0, sizeof(buf));
    buf.max = BUF_MAX;
    if (patchdl_http_post_external(url,
            "application/x-www-form-urlencoded; charset=UTF-8",
            body, &buf)) return -1;
    if (!buf.data) return -1;
    if (!json_success(buf.data)) {
        free(buf.data);
        return -1;
    }

    /* Each entry starts with "is_latest" and carries content_ver (Prospero)
       or version (Orbis), filesize and required_firmware. Bound each lookup
       to its own entry. */
    for (cur = strstr(buf.data, "\"is_latest\""); cur && n < max; cur = next) {
        char  entry[2048], fw[32] = {0};
        size_t len;
        patchdl_patch_version_t *v = &out[n];

        next = strstr(cur + 1, "\"is_latest\"");
        len  = next ? (size_t)(next - cur) : strlen(cur);
        if (len >= sizeof entry) len = sizeof entry - 1;
        memcpy(entry, cur, len);
        entry[len] = '\0';

        memset(v, 0, sizeof *v);
        if (!json_str_val(entry, "content_ver", v->version, sizeof v->version))
            json_str_val(entry, "version", v->version, sizeof v->version);
        json_str_val(entry, "filesize", v->size, sizeof v->size);
        json_str_val(entry, "required_firmware", fw, sizeof fw);
        if (!v->version[0]) continue;
        if (strchr(fw, '.') && strchr(strchr(fw, '.') + 1, '.')) {
            /* PS5 style "07.01.01.00": packed like Sony's system_ver */
            v->fw_bin = fw_str_to_bin(fw);
            fw_bin_to_display(v->fw_bin, v->required_fw, sizeof v->required_fw);
        } else {
            /* PS4 style "3.00": a PS4 firmware, never a limit on the PS5 */
            snprintf(v->required_fw, sizeof v->required_fw, "%s", fw);
            v->fw_bin = 0;
        }
        n++;
    }
    free(buf.data);
    *count = n;
    return 0;
}

int
patchdl_prospero_query(const char *title_id, uint32_t fw_bin,
                       patchdl_prospero_result_t *out) {
    patchdl_patch_version_t list[64];
    int                     n = 0, best = -1;

    if (!title_id || !out) return -1;
    memset(out, 0, sizeof(*out));
    if (patchdl_patchsite_versions(title_id, list, 64, &n)) return -1;

    /* the newest version whose firmware requirement is met */
    for (int i = 0; i < n; i++)
        if (list[i].fw_bin <= fw_bin &&
            (best < 0 || strcmp(list[i].version, list[best].version) > 0))
            best = i;
    if (best >= 0) {
        snprintf(out->version, sizeof out->version, "%s", list[best].version);
        snprintf(out->required_fw, sizeof out->required_fw, "%s", list[best].required_fw);
        snprintf(out->size, sizeof out->size, "%s", list[best].size);
        out->found = 1;
    }
    return 0;
}
