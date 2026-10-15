# PatchDL Web UI

Standalone static UI for the planned PS5 `patchdl.elf` web server.

Open `index.html` directly for the mock UI, or serve this directory from the
ELF web server. The JavaScript first tries the real API and falls back to demo
data when the API is not available.

The embedded ELF server serves this UI on port `12880` by default.

## Expected API

```text
GET  /api/status
GET  /api/config
POST /api/config
GET  /api/titles
GET  /api/downloads
GET  /api/installstatus
GET  /api/pkgmeta/:title_id
GET  /api/pkgverify/:title_id
POST /api/titles/:title_id/check
POST /api/titles/:title_id/download
POST /api/titles/:title_id/install
POST /api/titles/:title_id/enable
POST /api/titles/:title_id/disable
```

## Policy Model

The UI assumes deny-by-default behavior:

```json
{
  "default_policy": "deny",
  "download_dir": "/data/patchdl (internal)",
  "install_after_download": false,
  "delete_pkg_after_install": true,
  "source_policy": {
    "official": { "allow_check": true, "allow_download": true, "allow_install": true },
    "external": { "allow_check": true, "allow_download": true, "allow_install": true },
    "shadowmount": { "allow_check": true, "allow_download": false, "allow_install": false },
    "unknown": { "allow_check": true, "allow_download": false, "allow_install": false },
    "fake": { "allow_check": true, "allow_download": false, "allow_install": false }
  },
  "cdn_allowlist": [
    "sgst.prod.dl.playstation.net",
    "gst.prod.dl.playstation.net",
    "gs2.ww.prod.dl.playstation.net"
  ]
}
```

Per-title modes:

```text
disabled
download_only
latest_compatible
pin
check_only
```

Per-title source fields:

```json
{
  "title_id": "PPSA90001_00",
  "name": "Shadowmounted Test Title",
  "source_type": "shadowmount",
  "source_path": "/system_ex/app/PPSA90001_00",
  "mount_from": "/mnt/usb0/itemzflow/Shadowmounted Test Title",
  "enabled": true,
  "mode": "disabled"
}
```

Supported `source_type` values:

```text
official
external
shadowmount
unknown
```

The frontend lists `shadowmount`, `unknown` and `fake` titles under *Not
supported* and offers neither download nor install for them. The backend refuses
both as well, even if a client sends a forged request.

For PS5 game updates, the backend may turn a Sony `manifest_url` into a merged
local `.pkg` by downloading all manifest pieces. The `delta_url` `*-DP.pkg` is
not shown as a separate user action because it can bootstrap the storage/master
title instead of the installed regional target.

If `patch_storage_match` is false, the CDN stores the patch pieces under another
regional (master) title id. That is fine: the merged `.pkg` assembled from the
manifest carries the installed title's own content id, and AppInstUtil
`AppInstallPkg` installs it onto that title. The UI only adds a "Shared master"
label.
