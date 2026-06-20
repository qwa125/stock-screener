export interface DeviceRegistryEntry {
  fingerprint: string;
  ua: string;
  displayName?: string;
  firstSeen: number;
  lastSeen: number;
  remark?: string;
}