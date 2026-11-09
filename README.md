# Pipe

Made by [Ordixian](https://github.com/ordixian).

Local text and file sync between devices on the same network. No account, cloud, CDN, or internet connection is needed after dependencies are installed.

## Quick start for GitHub users

Install Node.js 20 or newer (with npm), then run:

```sh
git clone https://github.com/ordixian/pipe.git
cd pipe
npm ci
npm start
```

Open `http://localhost:3000` on the host computer. On another device on the same
network, open one of the URLs printed in the terminal and enter the pairing PIN.
Keep the server running while sharing. Press `Ctrl+C` to stop.

Windows users can run these commands in PowerShell. The optional `pipe` launcher
below requires Bash (Linux, macOS, or WSL). If installing `better-sqlite3` reports
that it must compile from source, install your platform's C/C++ build tools and
Python, then run `npm ci` again.

### Development

```sh
npm ci
npm run check
npm run build
npm run dev
```

The development command watches the server; run `npm run build` after changing
frontend files, then refresh the browser. GitHub Actions checks TypeScript and
builds the frontend on pushes and pull requests.

### Local storage and network access

Each installation starts with an empty feed. `data/` contains the local database
and paired-device sessions; `uploads/` contains shared files. Both directories,
local environment files, and build output are excluded from the public source.
Use Pipe on a trusted private network: transfers use HTTP, and paired devices
share access to the feed. This app needs its Node.js server and SQLite database;
GitHub Pages cannot run it.

## Start Pipe with one word

Requires Node.js 20 or newer and npm. In this folder, run this **once**:

```sh
bash setup-pipe-command.sh
```

Then type `pipe` in the terminal to start it. You can do this from this folder or any other folder. The first launch installs dependencies if needed, so that first launch needs internet access to fetch npm packages. Later launches work without internet. Keep the terminal open while using Pipe; press `Ctrl+C` to stop it. If setup says it changed your shell profile, open a new terminal first.

You can still use `npm install && npm start` directly. Startup builds the bundled app and starts the server on port 3000. Scan the QR code for the network your phone uses and enter the terminal's 4-digit PIN once per device. Files are stored in `uploads/`; the database is in `data/`. Back up those folders if needed.

## Connect over the same Wi-Fi

1. Connect the laptop and phone to the **same Wi-Fi network**. Avoid a guest network.
2. On the laptop, run `pipe` and leave the terminal open.
3. On the phone, scan the QR code printed for the laptop's Wi-Fi address. You can also type its `http://...:3000` URL into the phone browser.
4. Enter the 4-digit PIN shown in the terminal. Pipe opens the shared feed.
5. Send a short text item on one device. It should appear on the other within a second or two.

## Connect through your phone's Wi-Fi hotspot

1. **Android:** Swipe down and turn on **Hotspot**, or open Settings and find **Hotspot & tethering** / **Mobile Hotspot**. **iPhone:** Open **Settings → Personal Hotspot** and turn on **Allow Others to Join**. Note the hotspot password.
2. On the laptop, join the phone's hotspot in the laptop's Wi-Fi menu using that password.
3. Start Pipe on the laptop with `pipe` **after** the hotspot connection is active.
4. On the phone, scan the QR code for the laptop's hotspot Wi-Fi address. If several URLs appear, try the one associated with the new Wi-Fi connection.
5. Enter the terminal PIN. The phone itself stays on its hotspot; it does not need to join its own Wi-Fi network.

Pipe transfers data locally even if the hotspot has no internet connection. If the phone cannot open the laptop URL, try same Wi-Fi or Bluetooth; some hotspot configurations block access to connected devices.

## Connect through Bluetooth tethering

Bluetooth is usually much slower than Wi-Fi, so use it mainly for text or small files.

### Android phone

1. Turn on Bluetooth on the phone and laptop, then pair them in each device's Bluetooth settings.
2. On the phone, open **Hotspot & tethering** / **Mobile Hotspot** and turn on **Bluetooth tethering**.
3. On the laptop, join the phone's **Bluetooth Personal Area Network (PAN)**. On Windows 11, open **Settings → Bluetooth & devices → Devices**, expand the phone, and choose **Join** beside **Personal Area Network**. On Windows 10, use **Join a Personal Area Network** from the Bluetooth tray icon, then **Connect using → Access point**. On macOS, look for the paired phone's Bluetooth network service in Network/Bluetooth settings; availability depends on the phone and macOS version.
4. Once the Bluetooth network is connected, run `pipe` on the laptop.
5. Scan the QR code for the Bluetooth/PAN address, or type its URL on the phone, then enter the PIN.

### iPhone

1. On the iPhone, turn on **Settings → Personal Hotspot → Allow Others to Join** and turn on Bluetooth.
2. Turn on Bluetooth on the laptop and pair it with the iPhone. Keep the iPhone's Bluetooth settings open while pairing.
3. On a Mac, connect to the iPhone through the Bluetooth/Personal Hotspot settings. On Windows, join its Bluetooth PAN using the Windows steps above.
4. Once connected, run `pipe` on the laptop.
5. Open the printed Bluetooth/PAN URL on the iPhone and enter the PIN.

If no Bluetooth network address appears, check that the laptop joined the **network/PAN**, not just paired for Bluetooth audio, then restart Pipe.

## If the phone cannot open Pipe

1. Keep `pipe` running. Test `http://localhost:3000` on the laptop first.
2. Type the exact printed `http://...:3000` URL into the phone browser. Make sure the phone and laptop use the same connection method.
3. Turn off a VPN temporarily, and check that guest Wi-Fi or router **client isolation** is disabled.
4. Allow incoming connections to Node.js on the laptop's **TCP port 3000**:
   - **Windows:** In Windows Defender Firewall, allow Node.js on **Private** networks, or add an inbound TCP rule for port 3000. Set the current Wi-Fi/hotspot network to **Private** if appropriate.
   - **macOS:** Open **System Settings → Network → Firewall → Options** and allow incoming connections for Node.js if prompted or blocked.
   - **Linux with UFW:** Run `sudo ufw allow 3000/tcp`. For another firewall, allow inbound TCP 3000 on the local network.
5. If you changed networks after starting Pipe, stop it with `Ctrl+C`, then run `pipe` again to print the new addresses.

Platform instructions: [Android hotspot and tethering](https://support.google.com/android/answer/9059108), [iPhone Personal Hotspot](https://support.apple.com/guide/iphone/share-your-internet-connection-iph45447ca6/ios), [Windows Bluetooth PAN](https://support.microsoft.com/en-us/windows/hardware/bluetooth/connect-to-a-bluetooth-network-in-windows), and [macOS firewall](https://support.apple.com/guide/mac-help/block-connections-to-your-mac-with-a-firewall-mh34041/mac).

## Browser limits

Pipe serves local HTTP so it works without certificate setup. Browsers allow the main app and real-time sync over HTTP, but most phone browsers require a trusted HTTPS origin for PWA installation, service workers/offline app shell, Web Share Target, and clipboard API. Those features are included on a best-effort basis and activate only when the browser treats the origin as secure (for example `localhost` on the laptop). On phone HTTP, use the file picker and text box; the keyboard's Paste command works. While the server is stopped, the feed cannot sync or access stored files.

Uploads are streamed to disk with a 1 GB limit. Image previews are enabled only when file bytes match PNG, JPEG, GIF, or WebP signatures. The PIN changes on every start; existing paired sessions remain valid.

## Publish this release

The included `publish-github.sh` publishes the source as the public repository
`ordixian/pipe`. Install GitHub CLI, run `gh auth login` as `ordixian`, then run:

```sh
bash publish-github.sh
```

It copies only the listed project source files into a temporary Git repository,
checks the signed-in account, and stops if `ordixian/pipe` already exists.
