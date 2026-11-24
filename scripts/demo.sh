#!/usr/bin/env bash
set -euo pipefail
curl --fail --silent http://127.0.0.1:3001/api/health
curl --fail --silent 'http://127.0.0.1:3001/api/telemetry/latest'
curl --fail --silent 'http://127.0.0.1:3001/api/telemetry/history?machine_id=MCH-001&limit=5'
curl --fail --silent 'http://127.0.0.1:3001/api/system/stats'
