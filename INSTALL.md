# EchoGate AI - Installation Instructions
## Environment: Ubuntu / OpenLiteSpeed

This application is built with React and TypeScript. To run it on a production server, we need to compile the code into static HTML/JS/CSS files using **Node.js** and **Vite**, and then serve those files using **OpenLiteSpeed**.

---

### Step 1: Install Node.js
Connect to your Ubuntu server via SSH and install Node.js (Version 18+ recommended).

```bash
# Update repositories
sudo apt update
sudo apt install -y curl

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node -v
npm -v
```

---

### Step 2: Set up the Project Structure
Create a directory for your website and set up the file structure.

```bash
# Go to your web root (adjust path as needed)
cd /var/www/html/

# Create project folder
sudo mkdir echogate
sudo chown -R $USER:$USER echogate
cd echogate

# Create source folder
mkdir src
mkdir src/components
mkdir src/services
```

---

### Step 3: Create Configuration Files
Create the following files in the root of `/var/www/html/echogate/` using `nano` or your preferred editor. You can copy the content provided in the generated response for:

1. `package.json`
2. `vite.config.ts`
3. `tsconfig.json`
4. `tsconfig.node.json`

---

### Step 4: Upload Application Code
Copy your application files into the folders you created in Step 2.

**Root (`/var/www/html/echogate/`):**
- `index.html` (Note: You must edit this file slightly, see Step 5)
- `metadata.json`
- `types.ts` (Move this to `src/types.ts`)

**Src (`/var/www/html/echogate/src/`):**
- `index.tsx`
- `App.tsx`

**Components (`/var/www/html/echogate/src/components/`):**
- `Controls.tsx`
- `WaveformDisplay.tsx`

**Services (`/var/www/html/echogate/src/services/`):**
- `audioUtils.ts`
- `geminiService.ts`

---

### Step 5: Adjust `index.html` for Production
The current `index.html` is set up for a playground. Modify it to work with Vite.

Open `index.html`:
```bash
nano index.html
```

**Replace the content with this:**
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>EchoGate AI</title>
    <!-- Tailwind via CDN is fine for this setup -->
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
      body {
        font-family: 'Inter', sans-serif;
        background-color: #0f172a;
        color: #f8fafc;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <!-- Point to the local entry file -->
    <script type="module" src="/src/index.tsx"></script>
  </body>
</html>
```

---

### Step 6: Configure Environment Variables
Create a `.env` file to store your Gemini API Key securely.

```bash
nano .env
```

Add your key:
```
VITE_API_KEY=your_actual_google_gemini_api_key_here
```
*(Note: In the code, `process.env.API_KEY` is used. The `vite.config.ts` provided below handles mapping `VITE_API_KEY` to `process.env.API_KEY` automatically).*

---

### Step 7: Install Dependencies & Build
Now, install the libraries and build the static site.

```bash
# Install libraries
npm install

# Build the project
npm run build
```

This will create a `dist` folder inside `echogate`. This folder contains your production-ready website.

---

### Step 8: Configure OpenLiteSpeed

1. **Log in** to your OpenLiteSpeed WebAdmin Console (usually `https://your-ip:7080`).
2. Go to **Virtual Hosts** > **Add**.
   - **Virtual Host Name:** `echogate`
   - **Member Virtual Host Root:** `/var/www/html/echogate`
   - **Config File:** `$SERVER_ROOT/conf/vhosts/$VH_NAME/vhconf.conf`
   - **Enable Scripts/ExtApps:** Yes
   - **Restrained:** Yes
   - Click **Save** (it might tell you file doesn't exist, click "Click to create").
3. Go into the new **Virtual Host** configuration.
4. **General** Tab:
   - **Document Root:** `/var/www/html/echogate/dist`  <-- Important! Point to the 'dist' folder.
   - **Domain Name:** `yourdomain.com`
5. **Rewrite** Tab (Required for React Apps):
   - **Enable Rewrite:** Yes
   - **Rewrite Rules:**
     ```
     RewriteEngine On
     RewriteBase /
     RewriteRule ^index\.html$ - [L]
     RewriteCond %{REQUEST_FILENAME} !-f
     RewriteCond %{REQUEST_FILENAME} !-d
     RewriteRule . /index.html [L]
     ```
6. **Listeners**:
   - Go to **Listeners**. Add a listener for port 80 (HTTP) and 443 (HTTPS) mapping to your Virtual Host.
7. **Graceful Restart**: Click the green "Graceful Restart" button in the top right.

---

### Step 9: Permissions
Ensure OLS can read the build files.

```bash
sudo chown -R nobody:nogroup /var/www/html/echogate/dist
```
*(Note: Replace `nobody:nogroup` with the user:group OpenLiteSpeed runs as, often `lsadm:lsadm` or `www-data:www-data` depending on install).*

### Done!
Navigate to your domain. The app should load.
