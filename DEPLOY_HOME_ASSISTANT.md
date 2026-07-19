# Deploy MacroVault on Home Assistant

MacroVault is currently a static, local-first web app. It can be hosted directly from Home Assistant's `/config/www` folder without Docker or a separate web server.

## Fast Path: Home Assistant Static Hosting

1. In the Home Assistant terminal, create a folder for the app:

```sh
mkdir -p /config/www/macrovault
```

2. Copy these files into `/config/www/macrovault`:

```text
index.html
app.js
styles.css
service-worker.js
manifest.webmanifest
icon.svg
```

If you are using Studio Code Server, open `/config/www/macrovault` and upload or paste the files there.

3. Restart Home Assistant or reload the browser if the `/local` folder was already available.

4. Open the app:

```text
http://homeassistant.local:8123/local/macrovault/index.html
```

If `homeassistant.local` does not resolve on your network, use the Home Assistant machine's IP address:

```text
http://YOUR_HA_IP:8123/local/macrovault/index.html
```

## Important Data Note

This deployment hosts the app from the Home Assistant server, but the app data still lives in each browser's `localStorage`.

That means:

- The same phone/browser will keep its data.
- A different phone, laptop, or browser profile will start with separate data.
- Use the built-in JSON export/import buttons to move data between devices.

## Next Step: Shared Server Data

To make all devices share the same recipes, planner, pantry, and shopping list, add a small backend service with SQLite. The recommended architecture is:

```text
Browser app -> MacroVault API -> SQLite database on Home Assistant
```

Good hosting options:

- Home Assistant add-on: best long-term fit if this should live beside HA cleanly.
- Docker container: good if your HA install allows Docker/Portainer-style management.
- Separate mini server: cleanest if you do not want custom services on the HA host.

## Quick Migration Order

1. Host the current static app in `/config/www/macrovault`.
2. Export a JSON backup from the current browser.
3. Open the HA-hosted app and import the JSON backup.
4. Confirm recipes, planner, pantry, shopping list, and lunchbox data.
5. Decide whether shared multi-device storage is needed.
6. If yes, add SQLite/API and migrate the local JSON state into the database.
