# Simple Environment Switching

## 🎯 Quick Environment Switching

This is a simple way to switch between development and production environments by changing just one variable.

## 📝 How to Switch Environments

### Option 1: Using the Script (Recommended)
```bash
# Switch to development
node switch-env.js dev

# Switch to production
node switch-env.js prod
```

### Option 2: Using npm scripts
```bash
npm run dev    # Switch to development
npm run prod   # Switch to production
```

### Option 3: Manual Edit
Edit `js/config/constants.js` and change line 3:
```javascript
const CURRENT_ENVIRONMENT = 'development'; // Change to 'production' for prod
```

## 🌐 Environment URLs

- **Development**: `https://yadavshashankr.github.io/one-host-develop/`
- **Production**: `https://one-host.app/`

## 📦 GitHub Repositories

- **Development**: [https://github.com/yadavshashankr/one-host-develop.git](https://github.com/yadavshashankr/one-host-develop.git)
- **Production**: [https://github.com/yadavshashankr/one-host.git](https://github.com/yadavshashankr/one-host.git)

## 🚀 Deployment Process

### Quick Deployment
```bash
# Deploy to development
npm run deploy:dev

# Deploy to production
npm run deploy:prod
```

### Manual Deployment
1. **Switch Environment**:
   ```bash
   node switch-env.js dev    # or prod
   ```

2. **Update Git Remote** (if needed):
   ```bash
   # For development
   git remote set-url origin https://github.com/yadavshashankr/one-host-develop.git
   
   # For production
   git remote set-url origin https://github.com/yadavshashankr/one-host.git
   ```

3. **Commit and Push**:
   ```bash
   git add .
   git commit -m "Switch to [development/production]"
   git push
   ```

## 📁 Repository Setup

### For Development Testing
- Repository: `one-host-develop`
- Branch: `main`
- URL: `https://yadavshashankr.github.io/one-host-develop/`
- GitHub: [https://github.com/yadavshashankr/one-host-develop.git](https://github.com/yadavshashankr/one-host-develop.git)

### For Production
- Repository: `one-host`
- Branch: `main`
- URL: `https://one-host.app/`
- GitHub: [https://github.com/yadavshashankr/one-host.git](https://github.com/yadavshashankr/one-host.git)

## ✅ What Gets Updated

When you switch environments, these automatically use the correct URL:
- ✅ QR Code generation
- ✅ Share functionality
- ✅ Meta tags (Open Graph, Twitter)
- ✅ All JavaScript BASE_URL references

## 🔍 Verification

After switching, check the browser console to see:
```
One-Host Environment: development
Base URL: https://yadavshashankr.github.io/one-host-develop/
GitHub URL: https://github.com/yadavshashankr/one-host-develop.git
```

## 📋 Quick Commands

```bash
# Check current environment
node switch-env.js

# Switch to development
node switch-env.js dev

# Switch to production  
node switch-env.js prod

# Deploy to development
npm run deploy:dev

# Deploy to production
npm run deploy:prod

# Deploy to current environment
git add . && git commit -m "Update environment" && git push
```

## 🔧 Git Remote Management

The deployment script will automatically check and suggest the correct Git remote URL:

```bash
# Check current remote
git remote -v

# Update remote for development
git remote set-url origin https://github.com/yadavshashankr/one-host-develop.git

# Update remote for production
git remote set-url origin https://github.com/yadavshashankr/one-host.git
```

That's it! Just one command to switch environments and deploy to the correct repository. 🎉 