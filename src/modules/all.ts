// Centralized module registration (side-effect imports)
// Import this file to ensure all 16 modules are registered in the registry.
import "./cloud/aws.module.js";
import "./cloud/gcp.module.js";
import "./cloud/azure.module.js";
import "./cloud/on-prem.module.js";
import "./cloud/kubernetes.module.js";
import "./cloud/xserver.module.js";
import "./features/apm.module.js";
import "./features/logs.module.js";
import "./features/dashboards.module.js";
import "./features/monitors.module.js";
import "./features/synthetics.module.js";
import "./security/cspm.module.js";
import "./security/cws.module.js";
import "./security/asm.module.js";
import "./security/siem.module.js";
import "./security/sensitive-data.module.js";
