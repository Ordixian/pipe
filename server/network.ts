import os from 'os';

export interface NetworkAddress {
  interfaceName: string;
  ip: string;
  type: 'Wi-Fi / LAN' | 'Hotspot / USB / Tethering' | 'Bluetooth PAN' | 'Other';
}

export function getLocalAddresses(): NetworkAddress[] {
  const interfaces = os.networkInterfaces();
  const results: NetworkAddress[] = [];

  for (const [name, nets] of Object.entries(interfaces)) {
    if (!nets) continue;
    if (/^(lo|docker|veth|br-|virbr|vmnet|vboxnet)/i.test(name)) continue;

    for (const net of nets) {
      if (net.family === 'IPv4' && !net.internal) {
        let type: NetworkAddress['type'] = 'Other';
        const lower = name.toLowerCase();

        if (lower.includes('bnep') || lower.includes('bluetooth') || net.address.startsWith('172.20.10.')) {
          type = 'Bluetooth PAN';
        } else if (
          lower.includes('wlan') ||
          lower.includes('wi-fi') ||
          lower.includes('en0') ||
          lower.includes('eth') ||
          lower.includes('enp')
        ) {
          type = 'Wi-Fi / LAN';
        } else if (
          lower.includes('rndis') ||
          lower.includes('usb') ||
          lower.includes('ap') ||
          lower.includes('hotspot') ||
          net.address.startsWith('192.168.43.') ||
          net.address.startsWith('192.168.137.')
        ) {
          type = 'Hotspot / USB / Tethering';
        }

        results.push({ interfaceName: name, ip: net.address, type });
      }
    }
  }

  return results;
}
