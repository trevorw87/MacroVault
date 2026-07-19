# MacroVault

Local-first MVP for Ashley's family meal planning app.

## Run Locally

From this folder:

```powershell
node -e "const http=require('http'),fs=require('fs'),path=require('path');const root=process.cwd();const types={'.html':'text/html','.css':'text/css','.js':'text/javascript'};http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');let file=path.join(root,url.pathname==='/'?'index.html':url.pathname);if(!file.startsWith(root)){res.writeHead(403);return res.end('Forbidden')}fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found')}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(data)})}).listen(4173,'127.0.0.1',()=>console.log('MacroVault local: http://127.0.0.1:4173'))"
```

Then open:

```text
http://127.0.0.1:4173
```

## Host on Home Assistant

See [DEPLOY_HOME_ASSISTANT.md](DEPLOY_HOME_ASSISTANT.md) for the fastest server-hosted path using Home Assistant's `/config/www` static file hosting.

## Install as a Home Assistant Add-on

This repo also contains a Home Assistant add-on at `macrovault/`.

Once the repo is pushed to GitHub:

1. Open Home Assistant.
2. Go to Settings -> Add-ons -> Add-on Store.
3. Open the three-dot menu -> Repositories.
4. Add the GitHub repository URL.
5. Install and start the MacroVault add-on.
6. Open the add-on Web UI.

## What Works

- Dashboard with tonight's dinner and family metrics
- Recipe library with sample recipes
- Add, edit, delete, and favourite recipes
- Import recipe drafts from websites, YouTube links, or pasted recipe text
- Estimate protein, carbs, and fat from recognized ingredients
- Weekly dinner planner
- Shopping list generated from planned meals and grouped by category
- Pantry items that remove ingredients from the shopping list
- Pantry expiry dates with use-soon alerts
- Lunchbox Builder for weekly lunch planning
- Kids screen with ratings and healthy stars
- Browser `localStorage` persistence
- JSON export/import backup
- PWA manifest and basic offline cache

## Next Steps

- Add SQLite storage behind the same UI
- Add recipe photo and URL import
- Add user profiles for family members
- Dockerize for the Home Assistant NUC
