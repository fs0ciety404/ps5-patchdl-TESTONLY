/* SPDX-License-Identifier: GPL-3.0-or-later
 * Copyright (C) 2026 Knutwurst
 *
 * PatchDL is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version. See the LICENSE file in the project root for details.
 */

#pragma once

#include <stddef.h>

/*
 * PatchDL's own resolver. The console's DNS is often set up to block Sony's
 * hosts (that is how people keep the system from updating), so PatchDL never
 * asks it. A lookup tries, in this order, until one gives a usable answer:
 *
 *   1. plain DNS over UDP to 1.1.1.1, 8.8.8.8, 9.9.9.9, 1.0.0.1
 *   2. DNS over TCP to 1.1.1.1 and 8.8.8.8 (UDP/53 blocked or truncated)
 *   3. DNS over HTTPS to Cloudflare and Google (port 53 blocked or
 *      redirected to a filtering resolver)
 *   4. the addresses the last successful lookup saved to disk
 *
 * Answers in private, loopback or "this network" ranges count as blocked:
 * that is what filtering resolvers send back for Sony's hosts.
 */

#define PATCHDL_DNS_MAX_IPS 8

typedef struct {
    int  n;
    char ip[PATCHDL_DNS_MAX_IPS][16];
    char source[40];     /* e.g. "udp 1.1.1.1", "doh dns.google", "saved" */
    char trail[384];     /* what each step answered on the last fresh lookup */
} patchdl_dns_answer_t;

/* Resolve host (IPv4). Answers are cached for a few minutes and failures for
   a short while. 0 on success, -1 if every source failed. */
int  patchdl_dns_lookup(const char *host, patchdl_dns_answer_t *out);

/* Drop host's cached answer after its addresses refused or stalled a
   connection, so the next lookup asks again. An answer only seconds old is
   kept (minutes if it was slow to get), so many workers failing one after
   another trigger one new lookup, not one each. */
void patchdl_dns_forget(const char *host);

/* Drop host's cached answer unconditionally (diagnostics). */
void patchdl_dns_refresh(const char *host);

/* A new starting point for patchdl_dns_resolve_entry, once per request:
   parallel connections and retries then spread over the CDN edges instead
   of all trying the first address. */
unsigned patchdl_dns_rotation(void);

/* Room for any entry: a 255-character host, port and every address. */
#define PATCHDL_DNS_ENTRY_MAX (256 + 8 + PATCHDL_DNS_MAX_IPS * 16)

/* "host:port:ip1,ip2,..." for CURLOPT_RESOLVE, starting at address
   rotation % n. curl moves on to the next address when one doesn't connect.
   -1 if it doesn't fit in sz. */
int  patchdl_dns_resolve_entry(const patchdl_dns_answer_t *a, const char *host,
                               int port, unsigned rotation, char *out, size_t sz);
