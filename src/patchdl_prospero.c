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

int
patchdl_prospero_query(const char *title_id, uint32_t fw_bin,
                       patchdl_prospero_result_t *out) {
    patchdl_buf_t buf;
    char url[256], key[128], body[256];
    char best_ver[16] = {0}, best_size[16] = {0};
    uint32_t best_fw = 0;

    if (!title_id || !out) return -1;
    memset(out, 0, sizeof(*out));

    /* Step 1: fetch the title page to get the data-key. */
    memset(&buf, 0, sizeof(buf));
    buf.max = BUF_MAX;
    snprintf(url, sizeof(url), "%s/%.16s", PROSPERO_BASE, title_id);
    if (patchdl_http_get_external(url, &buf)) return -1;
    if (!buf.data) return -1;

    if (extract_data_key(buf.data, key, sizeof(key))) {
        free(buf.data);
        return -1;
    }
    free(buf.data);

    /* Step 2: POST loadpatches. The API expects JSON in the body but
       application/x-www-form-urlencoded as Content-Type — this is how
       the website and every known third-party client calls it. */
    snprintf(body, sizeof(body),
             "{\"titleid\":\"%.16s\",\"key\":\"%s\"}", title_id, key);

    memset(&buf, 0, sizeof(buf));
    buf.max = BUF_MAX;
    if (patchdl_http_post_external(
            PROSPERO_API "/loadpatches",
            "application/x-www-form-urlencoded; charset=UTF-8",
            body, &buf)) return -1;
    if (!buf.data) return -1;

    if (!json_success(buf.data)) {
        free(buf.data);
        return -1;
    }

    /* Walk the patches array. Each entry looks like:
       {"content_ver":"01.003.000","required_firmware":"07.01.01.00",...}
       Find the newest version whose firmware requirement is met. */
    const char *cursor = buf.data;
    while ((cursor = strstr(cursor, "\"content_ver\""))) {
        char ver[16] = {0}, fw[32] = {0}, size[16] = {0};

        json_str_val(cursor, "content_ver", ver, sizeof(ver));
        json_str_val(cursor, "filesize", size, sizeof(size));
        json_str_val(cursor, "required_firmware", fw, sizeof(fw));

        if (ver[0] && fw[0]) {
            uint32_t pkg_fw = fw_str_to_bin(fw);
            if (pkg_fw <= fw_bin) {
                if (!best_ver[0] || strcmp(ver, best_ver) > 0) {
                    strncpy(best_ver, ver, sizeof(best_ver) - 1);
                    memcpy(best_size, size, sizeof(best_size));
                    best_fw = pkg_fw;
                }
            }
        }
        cursor++;
    }
    free(buf.data);

    if (best_ver[0]) {
        strncpy(out->version, best_ver, sizeof(out->version) - 1);
        fw_bin_to_display(best_fw, out->required_fw, sizeof(out->required_fw));
        memcpy(out->size, best_size, sizeof(out->size));
        out->found = 1;
    }
    return 0;
}
