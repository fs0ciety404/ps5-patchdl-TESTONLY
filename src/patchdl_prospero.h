/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Knutwurst
 *
 * PatchDL is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version. See the LICENSE file in the project root for details.
 */

#pragma once

#include <stdint.h>

typedef struct {
    char version[16];      /* e.g. "01.003.000" */
    char required_fw[16];  /* PatchDL display format, e.g. "7.01" */
    char size[16];         /* Prospero's label, e.g. "71.7 GB" (GiB, rounded up) */
    int  found;
} patchdl_prospero_result_t;

/* Query prosperopatches.com for the newest patch of `title_id` whose
   firmware requirement is <= fw_bin. Returns 0 on success (result may
   still have found==0 if no compatible patch exists), -1 on network or
   parse failure. Best-effort: a failure means the UI shows no Prospero
   data, nothing breaks. */
int patchdl_prospero_query(const char *title_id, uint32_t fw_bin,
                           patchdl_prospero_result_t *out);

/* One patch version as Prospero Patches (PS5) or Orbis Patches (PS4) lists it. */
typedef struct {
    char     version[16];      /* "01.003.000" (PS5) or "01.07" (PS4) */
    char     required_fw[16];  /* display form; for PS4 a PS4 firmware */
    char     size[16];         /* the site's label, e.g. "8.7GB" */
    uint32_t fw_bin;           /* PS5 firmware it needs, 0 for PS4 */
} patchdl_patch_version_t;

/* Base URL of the site that lists this title's patches. */
const char *patchdl_patchsite_base(const char *title_id);

/* Every version the site lists for title_id, newest first as the site
   orders them. 0 on success with *count entries (up to max). */
int patchdl_patchsite_versions(const char *title_id, patchdl_patch_version_t *out,
                               int max, int *count);
