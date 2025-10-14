"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isMacOSArm64 = isMacOSArm64;
exports.isUbuntu = isUbuntu;
const os_1 = __importDefault(require("os"));
const fs_1 = __importDefault(require("fs"));
const platform = os_1.default.platform();
const arch = os_1.default.arch();
function isMacOSArm64() {
    return platform === 'darwin' && arch === 'arm64';
}
function isUbuntu() {
    if (platform !== 'linux')
        return false;
    try {
        const osRelease = fs_1.default.readFileSync('/etc/os-release', 'utf8');
        const match = osRelease.match(/^ID=(.*)$/m);
        if (!match)
            return false;
        const id = match[1].replace(/"/g, '').trim().toLowerCase();
        return id === 'ubuntu';
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=platform.js.map