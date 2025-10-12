const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const { spawn, exec } = require('child_process');
const os = require('os');
const axios = require('axios');
const https = require('https');
const http = require('http');
// Using bundled UnRAR.exe instead of Node.js dependencies

// Function to get all available drives on Windows
async function getAvailableDrives() {
  return new Promise((resolve) => {
    exec('wmic logicaldisk get size,freespace,caption', (error, stdout) => {
      if (error) {
        console.warn('Could not get drives via wmic, using fallback');
        // Fallback to common drive letters
        resolve(['C:', 'D:', 'E:', 'F:', 'G:', 'H:', 'Z:']);
        return;
      }
      
      const drives = [];
      const lines = stdout.split('\n');
      
      for (const line of lines) {
        const match = line.trim().match(/^([A-Z]:)/);
        if (match) {
          drives.push(match[1]);
        }
      }
      
      // If no drives found, use fallback
      if (drives.length === 0) {
        drives.push('C:', 'D:', 'E:', 'F:', 'G:', 'H:', 'Z:');
      }
      
      console.log('Detected drives:', drives);
      resolve(drives);
    });
  });
}

// Helper function to parse Steam's libraryfolders.vdf file
function parseLibraryFoldersVdf(vdfContent) {
  const libraries = [];
  
  try {
    // Simple VDF parser for libraryfolders.vdf
    const lines = vdfContent.split('\n');
    let currentLibrary = null;
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Look for library entries (numbered sections)
      if (/^"\d+"$/.test(trimmed)) {
        currentLibrary = {};
      } else if (currentLibrary && trimmed.startsWith('"path"')) {
        // Extract path value
        const match = trimmed.match(/"path"\s+"([^"]+)"/);
        if (match) {
          currentLibrary.path = match[1].replace(/\\\\/g, '\\'); // Fix escaped backslashes
          libraries.push(currentLibrary);
          currentLibrary = null;
        }
      }
    }
  } catch (error) {
    console.warn('Error parsing libraryfolders.vdf:', error.message);
  }
  
  return libraries;
}

// Enhanced game detection that checks multiple platforms
async function findGameInstallations() {
  const gameInstallations = [];
  
  console.log('Searching for Lies of P installations across all platforms...');
  
  // 1. Steam detection
  const steamLibraries = await findSteamLibraries();
  for (const libraryPath of steamLibraries) {
    const steamGamePath = path.join(libraryPath, 'steamapps', 'common', 'Lies of P');
    if (await fs.pathExists(steamGamePath)) {
      gameInstallations.push({
        path: steamGamePath,
        platform: 'Steam',
        libraryPath: libraryPath
      });
    }
  }
  
  // 2. Epic Games Store detection
  const epicPaths = await findEpicGamesInstallations();
  gameInstallations.push(...epicPaths);
  
  // 3. Microsoft Store / Xbox Game Pass detection
  const microsoftPaths = await findMicrosoftStoreInstallations();
  gameInstallations.push(...microsoftPaths);
  
  // 4. Common installation directories (including pirated versions)
  const commonPaths = await findCommonInstallations();
  gameInstallations.push(...commonPaths);
  
  console.log(`Found ${gameInstallations.length} Lies of P installations:`, gameInstallations);
  return gameInstallations;
}

// Enhanced Steam detection that checks multiple library folders
async function findSteamLibraries() {
  // Get all available drives
  const drives = await getAvailableDrives();
  console.log('Available drives:', drives);
  
  const steamPaths = [];
  
  // Add Steam paths for each drive
  for (const drive of drives) {
    steamPaths.push(
      path.join(drive, 'Program Files (x86)', 'Steam'),
      path.join(drive, 'Program Files', 'Steam'),
      path.join(drive, 'Steam')
    );
  }
  
  // Also add user-specific paths
  steamPaths.push(path.join(os.homedir(), 'AppData', 'Local', 'Steam'));
  
  console.log('Checking Steam paths:', steamPaths);
  
  let mainSteamPath = null;
  
  // Find main Steam installation
  for (const steamPath of steamPaths) {
    console.log('Checking Steam path:', steamPath);
    if (await fs.pathExists(steamPath)) {
      console.log('Found Steam at:', steamPath);
      mainSteamPath = steamPath;
      break;
    }
  }
  
  // Try registry if not found in common paths
  if (!mainSteamPath) {
    mainSteamPath = await new Promise((resolve) => {
      exec('reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Valve\\Steam" /v InstallPath', (error, stdout) => {
        if (!error && stdout) {
          const match = stdout.match(/InstallPath\s+REG_SZ\s+(.+)/);
          if (match) {
            resolve(match[1].trim());
          } else {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      });
    });
  }
  
  if (!mainSteamPath) {
    return [];
  }
  
  const libraries = [mainSteamPath]; // Always include main Steam path
  
  // Try to read libraryfolders.vdf for additional libraries
  try {
    const libraryFoldersPath = path.join(mainSteamPath, 'steamapps', 'libraryfolders.vdf');
    
    if (await fs.pathExists(libraryFoldersPath)) {
      const vdfContent = await fs.readFile(libraryFoldersPath, 'utf8');
      const additionalLibraries = parseLibraryFoldersVdf(vdfContent);
      
      for (const lib of additionalLibraries) {
        if (lib.path && lib.path !== mainSteamPath) {
          libraries.push(lib.path);
        }
      }
    }
  } catch (error) {
    console.warn('Could not read libraryfolders.vdf:', error.message);
  }
  
  return libraries;
}

// Epic Games Store detection
async function findEpicGamesInstallations() {
  const installations = [];
  
  try {
    // Epic Games Store manifest files location
    const epicManifestsPath = path.join(os.homedir(), 'AppData', 'Local', 'EpicGamesLauncher', 'Saved', 'Logs');
    const epicInstallsPath = 'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests';
    
    // Get all available drives for Epic Games detection
    const drives = await getAvailableDrives();
    
    // Common Epic Games installation directories for each drive
    const epicCommonPaths = [];
    
    for (const drive of drives) {
      epicCommonPaths.push(
        path.join(drive, 'Program Files', 'Epic Games'),
        path.join(drive, 'Epic Games')
      );
    }
    
    // Also add user-specific paths
    epicCommonPaths.push(path.join(os.homedir(), 'Epic Games'));
    
    // Check common Epic paths
    for (const epicPath of epicCommonPaths) {
      if (await fs.pathExists(epicPath)) {
        const possibleGamePaths = [
          path.join(epicPath, 'LiesofP'),
          path.join(epicPath, 'Lies of P'),
          path.join(epicPath, 'LOP')
        ];
        
        for (const gamePath of possibleGamePaths) {
          if (await fs.pathExists(gamePath)) {
            // Verify it's actually Lies of P by checking for executable
            const exePaths = [
              path.join(gamePath, 'LiesofP.exe'),
              path.join(gamePath, 'LOP.exe'),
              path.join(gamePath, 'Binaries', 'Win64', 'LiesofP-Win64-Shipping.exe')
            ];
            
            for (const exePath of exePaths) {
              if (await fs.pathExists(exePath)) {
                installations.push({
                  path: gamePath,
                  platform: 'Epic Games Store',
                  executable: exePath
                });
                break;
              }
            }
          }
        }
      }
    }
  } catch (error) {
    console.warn('Error detecting Epic Games installations:', error.message);
  }
  
  return installations;
}

// Microsoft Store / Xbox Game Pass detection
async function findMicrosoftStoreInstallations() {
  const installations = [];
  
  try {
    // Microsoft Store apps are typically installed in WindowsApps
    const windowsAppsPath = 'C:\\Program Files\\WindowsApps';
    
    if (await fs.pathExists(windowsAppsPath)) {
      try {
        const apps = await fs.readdir(windowsAppsPath);
        
        // Look for Lies of P related folders
        const liesOfPApps = apps.filter(app => 
          app.toLowerCase().includes('liesofp') || 
          app.toLowerCase().includes('lies') ||
          app.toLowerCase().includes('neowiz')
        );
        
        for (const appFolder of liesOfPApps) {
          const appPath = path.join(windowsAppsPath, appFolder);
          
          // Check if it contains game files
          const possibleExes = [
            path.join(appPath, 'LiesofP.exe'),
            path.join(appPath, 'LOP.exe'),
            path.join(appPath, 'Game', 'LiesofP.exe')
          ];
          
          for (const exePath of possibleExes) {
            if (await fs.pathExists(exePath)) {
              installations.push({
                path: appPath,
                platform: 'Microsoft Store',
                executable: exePath
              });
              break;
            }
          }
        }
      } catch (error) {
        // WindowsApps folder might not be accessible, that's okay
        console.warn('Could not access WindowsApps folder:', error.message);
      }
    }
  } catch (error) {
    console.warn('Error detecting Microsoft Store installations:', error.message);
  }
  
  return installations;
}

// Common installation directories (including pirated versions)
async function findCommonInstallations() {
  const installations = [];
  
  // Get all available drives
  const drives = await getAvailableDrives();
  
  // Common game installation directories for each drive
  const commonBasePaths = [];
  
  for (const drive of drives) {
    commonBasePaths.push(
      path.join(drive, 'Games'),
      path.join(drive, 'Program Files'),
      path.join(drive, 'Program Files (x86)'),
      drive // Root of drive
    );
  }
  
  // Also add user-specific paths
  commonBasePaths.push(
    path.join(os.homedir(), 'Games'),
    path.join(os.homedir(), 'Desktop')
  );
  
  // Possible game folder names
  const gameFolderNames = [
    'Lies of P',
    'LiesofP',
    'LOP',
    'Lies.of.P',
    'Lies_of_P'
  ];
  
  for (const basePath of commonBasePaths) {
    if (await fs.pathExists(basePath)) {
      for (const gameFolder of gameFolderNames) {
        const gamePath = path.join(basePath, gameFolder);
        
        if (await fs.pathExists(gamePath)) {
          // Verify it's actually Lies of P by checking for executable
          const exePaths = [
            path.join(gamePath, 'LiesofP.exe'),
            path.join(gamePath, 'LOP.exe'),
            path.join(gamePath, 'Binaries', 'Win64', 'LiesofP-Win64-Shipping.exe'),
            path.join(gamePath, 'Game', 'Binaries', 'Win64', 'LiesofP-Win64-Shipping.exe')
          ];
          
          for (const exePath of exePaths) {
            if (await fs.pathExists(exePath)) {
              installations.push({
                path: gamePath,
                platform: 'Manual Installation',
                executable: exePath
              });
              break;
            }
          }
        }
      }
    }
  }
  
  return installations;
}

// Download function with progress tracking using axios
async function downloadFile(url, outputPath, onProgress) {
  const startTime = Date.now();
  let lastUpdateTime = 0;
  const UPDATE_INTERVAL = 2000; // 2 seconds
  
  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 300000,
      headers: {
        'User-Agent': 'Lies-of-P-Installer/1.0.0'
      }
    });

    const totalBytes = parseInt(response.headers['content-length'], 10);
    let downloadedBytes = 0;

    const writer = fs.createWriteStream(outputPath);

    response.data.on('data', (chunk) => {
      downloadedBytes += chunk.length;
      const now = Date.now();
      
      // Only update progress every 2 seconds
      if (onProgress && (now - lastUpdateTime >= UPDATE_INTERVAL)) {
        lastUpdateTime = now;
        const elapsed = (now - startTime) / 1000;
        const speed = downloadedBytes / elapsed;
        const percentage = totalBytes ? (downloadedBytes / totalBytes) * 100 : 0;

        onProgress({
          downloadedBytes,
          totalBytes,
          percentage,
          speed,
          elapsed
        });
      }
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        // Send final 100% update
        if (onProgress) {
          const elapsed = (Date.now() - startTime) / 1000;
          const speed = downloadedBytes / elapsed;
          onProgress({
            downloadedBytes,
            totalBytes,
            percentage: 100,
            speed,
            elapsed
          });
        }
        
        writer.close();
        // Longer delay to ensure file is released
        setTimeout(resolve, 500);
      });

      writer.on('error', (err) => {
        writer.close();
        fs.unlink(outputPath, () => {});
        reject(err);
      });
    });
  } catch (error) {
    console.error('Download error:', error);
    throw new Error(`Error descargando archivo: ${error.message}`);
  }
}

// Extract RAR file using bundled UnRAR.exe with multiple fallback options
async function extractRarFile(rarPath, extractPath) {
  try {
    console.log(`Extracting RAR file: ${rarPath} to ${extractPath}`);
    
    // Ensure extract directory exists
    await fs.ensureDir(extractPath);
    
    // Find UnRAR.exe first - prioritize production paths
    const possibleUnRARPaths = [
      // Production paths (when packaged)
      path.join(process.resourcesPath, 'assets', 'UnRAR.exe'),
      path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'UnRAR.exe'),
      path.join(process.resourcesPath, 'app', 'assets', 'UnRAR.exe'),
      // Development paths
      path.join(__dirname, '..', 'assets', 'UnRAR.exe'),
      path.join(process.cwd(), 'assets', 'UnRAR.exe')
    ];
    
    let unrarPath = null;
    for (const testPath of possibleUnRARPaths) {
      if (await fs.pathExists(testPath)) {
        unrarPath = testPath;
        console.log('✅ Found UnRAR.exe at:', unrarPath);
        break;
      } else {
        console.log('❌ Not found at:', testPath);
      }
    }
    
    if (!unrarPath) {
      throw new Error('UnRAR.exe not found in any location');
    }
    
    // Execute UnRAR directly with the found path
    const command = `"${unrarPath}" x -y "${rarPath}" "${extractPath}\\"`;
    console.log('Executing command:', command);
    
    await new Promise((resolve, reject) => {
      exec(command, { timeout: 600000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          console.error('UnRAR error:', error);
          console.error('stderr:', stderr);
          reject(error);
        } else {
          console.log('UnRAR stdout:', stdout);
          resolve();
        }
      });
    });
    
    console.log('RAR extraction completed successfully');
  } catch (error) {
    console.error('Error during RAR extraction:', error);
    throw new Error(`Error extrayendo archivo RAR: ${error.message}`);
  }
}

// Extract using UnRAR with multiple fallback options
async function extractWithUnRAR(rarPath, extractPath) {
  console.log('Using UnRAR for RAR extraction (best for split archives)');

  const extractionTools = [
    // UnRAR.exe (MEJOR OPCIÓN - diseñado específicamente para RAR)
    // Modo desarrollo - ruta directa
    { path: path.join(process.cwd(), 'assets', 'UnRAR.exe'), type: 'unrar' },
    { path: path.join(__dirname, '..', 'assets', 'UnRAR.exe'), type: 'unrar' },
    // Modo empaquetado
    { path: path.join(process.resourcesPath, 'app', 'assets', 'UnRAR.exe'), type: 'unrar' },
    { path: path.join(process.resourcesPath, 'assets', 'UnRAR.exe'), type: 'unrar' },
    // WinRAR (si está instalado)
    { path: 'C:\\Program Files\\WinRAR\\unrar.exe', type: 'unrar' },
    { path: 'C:\\Program Files (x86)\\WinRAR\\unrar.exe', type: 'unrar' },
    { path: 'C:\\Program Files\\WinRAR\\WinRAR.exe', type: 'winrar' },
    { path: 'C:\\Program Files (x86)\\WinRAR\\WinRAR.exe', type: 'winrar' },
    // 7-Zip (como fallback)
    { path: 'C:\\Program Files\\7-Zip\\7z.exe', type: '7zip' },
    { path: 'C:\\Program Files (x86)\\7-Zip\\7z.exe', type: '7zip' },
    { path: path.join(__dirname, '..', 'assets', '7za.exe'), type: '7zip' }
  ];

  let lastError = null;

  console.log('Current working directory:', process.cwd());
  console.log('__dirname:', __dirname);
  console.log('process.resourcesPath:', process.resourcesPath);

  for (const tool of extractionTools) {
    try {
      console.log(`\n=== Trying ${tool.type.toUpperCase()} ===`);
      console.log(`Path: ${tool.path}`);
      
      // Check if the executable exists
      if (tool.path.includes('\\') || tool.path.includes('/')) {
        const exists = await fs.pathExists(tool.path);
        console.log(`File exists check: ${exists}`);
        if (!exists) {
          console.log(`❌ File not found: ${tool.path}`);
          continue;
        }
        console.log(`✅ Found: ${tool.path}`);
      }
      
      // Use appropriate extraction method
      await extractWithTool(tool, rarPath, extractPath);

      console.log(`Successfully extracted using ${tool.type.toUpperCase()} at: ${tool.path}`);
      return; // Success, exit function
      
    } catch (error) {
      console.warn(`Failed with ${tool.type.toUpperCase()} at ${tool.path}:`, error.message);
      lastError = error;
      continue; // Try next path
    }
  }

  // If all attempts failed, try manual command line extraction
  try {
    console.log('Trying manual command line extraction...');
    await extractWithCommandLine(rarPath, extractPath);
  } catch (cmdError) {
    console.error('Command line extraction also failed:', cmdError);
    throw new Error(`No se pudo extraer el archivo. Último error: ${lastError?.message || cmdError.message}`);
  }
}

// Extract with appropriate tool based on type
async function extractWithTool(tool, rarPath, extractPath) {
  return new Promise(async (resolve, reject) => {
    try {
      // Verify RAR file is accessible before extraction
      const stats = await fs.stat(rarPath);
      console.log(`RAR file size: ${stats.size} bytes, modified: ${stats.mtime}`);
      
      // Test file access by trying to read a small portion
      await fs.access(rarPath, fs.constants.R_OK);
      console.log('RAR file is accessible for reading');
    } catch (accessError) {
      reject(new Error(`Cannot access RAR file: ${accessError.message}`));
      return;
    }

    let command;
    
    if (tool.type === 'unrar') {
      // UnRAR command: UnRAR.exe x -y "archive.rar" "output_folder\\"
      command = `"${tool.path}" x -y "${rarPath}" "${extractPath}\\"`;    
    } else if (tool.type === 'winrar') {
      // WinRAR command: WinRAR.exe x -y "archive.rar" "output_folder\\"
      command = `"${tool.path}" x -y "${rarPath}" "${extractPath}\\"`;    
    } else {
      // 7-Zip command: 7z.exe x "archive.rar" -o"output_folder" -y
      command = `"${tool.path}" x "${rarPath}" -o"${extractPath}" -y`;
    }
    
    console.log(`Executing ${tool.type.toUpperCase()} command: ${command}`);
    
    const process = exec(command, { 
      timeout: 600000, // 10 minutes timeout
      maxBuffer: 1024 * 1024 * 10 // 10MB buffer
    }, (error, stdout, stderr) => {
      console.log(`=== ${tool.type.toUpperCase()} OUTPUT ===`);
      console.log('STDOUT:', stdout);
      console.log('STDERR:', stderr);
      console.log('ERROR:', error ? error.message : 'none');
      
      if (error) {
        console.error(`${tool.type.toUpperCase()} extraction error: ${error.message}`);
        reject(new Error(`${tool.type.toUpperCase()} extraction failed: ${error.message}`));
      } else {
        console.log(`${tool.type.toUpperCase()} extraction completed successfully`);
        resolve();
      }
    });
    
    // Handle process events for better debugging
    process.on('spawn', () => {
      console.log(`${tool.type.toUpperCase()} process spawned successfully`);
    });
    
    process.on('error', (error) => {
      console.error(`Failed to spawn ${tool.type.toUpperCase()} process:`, error);
      reject(error);
    });
  });
}

// Fallback: Manual command line extraction
async function extractWithCommandLine(rarPath, extractPath) {
  return new Promise((resolve, reject) => {
    // Try different command line tools for RAR (prioritize UnRAR)
    const bundledUnRAR1 = path.join(process.cwd(), 'assets', 'UnRAR.exe');
    const bundledUnRAR2 = path.join(__dirname, '..', 'assets', 'UnRAR.exe');
    const bundled7za = path.join(__dirname, '..', 'assets', '7za.exe');
    const commands = [
      `"${bundledUnRAR1}" x -y "${rarPath}" "${extractPath}\\"`,
      `"${bundledUnRAR2}" x -y "${rarPath}" "${extractPath}\\"`,  
      `"${bundled7za}" x "${rarPath}" -o"${extractPath}" -y`,
      `"C:\\Program Files\\7-Zip\\7z.exe" x "${rarPath}" -o"${extractPath}" -y`,
      `"C:\\Program Files (x86)\\7-Zip\\7z.exe" x "${rarPath}" -o"${extractPath}" -y`,
      `7z x "${rarPath}" -o"${extractPath}" -y` 
    ];

    let commandIndex = 0;

    const tryNextCommand = () => {
      if (commandIndex >= commands.length) {
        reject(new Error('Todos los métodos de extracción fallaron'));
        return;
      }

      const command = commands[commandIndex];
      console.log(`Trying command: ${command}`);

      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.warn(`Command failed: ${command}`, error.message);
          commandIndex++;
          tryNextCommand();
        } else {
          console.log('Manual extraction successful');
          resolve();
        }
      });
    };

    tryNextCommand();
  });
}

// Format bytes to human readable
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Format speed
function formatSpeed(bytesPerSecond) {
  return formatBytes(bytesPerSecond) + '/s';
}

// Create backup of existing files
async function createBackup(sourcePath, backupPath) {
  try {
    if (await fs.pathExists(sourcePath)) {
      await fs.ensureDir(path.dirname(backupPath));
      await fs.copy(sourcePath, backupPath, { overwrite: true });
      console.log('Backup created:', backupPath);
      return true;
    }
    return false;
  } catch (error) {
    console.warn('Could not create backup:', error.message);
    return false;
  }
}

// Restore backup files
async function restoreBackup(backupPath, targetPath) {
  try {
    if (await fs.pathExists(backupPath)) {
      await fs.ensureDir(path.dirname(targetPath));
      await fs.copy(backupPath, targetPath, { overwrite: true });
      console.log('Backup restored:', targetPath);
      return true;
    }
    return false;
  } catch (error) {
    console.warn('Could not restore backup:', error.message);
    return false;
  }
}

// Get backup directory path
function getBackupDir(gamePath) {
  return path.join(gamePath, 'LiesofP', 'Content', 'Movies', '_backup_ecos_del_doblaje');
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    frame: false,
    resizable: true,
    icon: path.join(__dirname, '../assets/icon.ico'),
    show: false
  });

  mainWindow.loadFile('src/index.html');
  
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC handlers
ipcMain.handle('minimize-window', () => {
  mainWindow.minimize();
});

ipcMain.handle('close-window', () => {
  mainWindow.close();
});

ipcMain.handle('detect-steam-path', async () => {
  try {
    console.log('Starting enhanced multi-platform game detection...');
    const gameInstallations = await findGameInstallations();
    
    if (gameInstallations.length === 0) {
      console.log('No Lies of P installations found');
      return null;
    }
    
    // Prioritize Steam installations, then others
    const steamInstallation = gameInstallations.find(install => install.platform === 'Steam');
    if (steamInstallation) {
      console.log('Found Steam installation:', steamInstallation.path);
      return steamInstallation.path;
    }
    
    // If no Steam installation, return the first found installation
    const firstInstallation = gameInstallations[0];
    console.log(`Found ${firstInstallation.platform} installation:`, firstInstallation.path);
    return firstInstallation.path;
  } catch (error) {
    console.error('Error detecting game path:', error);
    return null;
  }
});

ipcMain.handle('check-startup-mod-status', async () => {
  try {
    // Use enhanced multi-platform detection
    console.log('Checking startup mod status with enhanced multi-platform detection...');
    const gameInstallations = await findGameInstallations();
    
    let gamePath = null;
    
    if (gameInstallations.length > 0) {
      // Prioritize Steam installations, then others
      const steamInstallation = gameInstallations.find(install => install.platform === 'Steam');
      if (steamInstallation) {
        gamePath = steamInstallation.path;
      } else {
        gamePath = gameInstallations[0].path;
      }
    }

    if (!gamePath) {
      return { found: false, gamePath: null, modInstalled: false };
    }

    // Check if mods are installed - try multiple possible directory structures
    const possibleModDirs = [
      path.join(gamePath, 'LiesofP', 'Content', 'Paks', '~mods'),
      path.join(gamePath, 'LiesOfP', 'Content', 'Paks', '~mods'),
      path.join(gamePath, 'Content', 'Paks', '~mods')
    ];
    
    let modInstalled = false;
    let foundModsDir = null;
    let installedMods = {
      dubbing: false,
      music: false,
      locres: false
    };
    
    console.log('Checking for mods in multiple possible locations:');
    for (const modsDir of possibleModDirs) {
      console.log('Testing mods directory:', modsDir);
      const dirExists = await fs.pathExists(modsDir);
      console.log('Directory exists:', dirExists);
      
      if (dirExists) {
        foundModsDir = modsDir;
        
        // Check for dubbing mod
        const dubbingModPath = path.join(modsDir, '000_Spanishmod_P.pak');
        const dubbingExists = await fs.pathExists(dubbingModPath);
        console.log('Dubbing mod exists:', dubbingExists);
        
        // Check for music mod
        const musicModPath = path.join(modsDir, '000_SpanishMusicmod_P.pak');
        const musicExists = await fs.pathExists(musicModPath);
        console.log('Music mod exists:', musicExists);
        
        // Check for locres mod
        const locresModPath = path.join(modsDir, '000_SpanishLocresmod_P.pak');
        const locresExists = await fs.pathExists(locresModPath);
        console.log('Locres mod exists:', locresExists);
        
        installedMods.dubbing = dubbingExists;
        installedMods.music = musicExists;
        installedMods.locres = locresExists;
        
        if (dubbingExists || musicExists || locresExists) {
          modInstalled = true;
          break;
        }
      }
    }

    console.log('Startup detection results:', { 
      found: true, 
      gamePath, 
      modInstalled, 
      foundModsDir,
      installedMods,
      testedDirs: possibleModDirs 
    });
    
    return { found: true, gamePath, modInstalled, installedMods };
  } catch (error) {
    console.error('Error checking startup mod status:', error);
    return { found: false, gamePath: null, modInstalled: false };
  }
});

ipcMain.handle('browse-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Selecciona la carpeta de Lies of P'
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('validate-game-path', async (event, gamePath) => {
  try {
    // Check for both possible executable names
    const exePath1 = path.join(gamePath, 'LiesOfP.exe');
    const exePath2 = path.join(gamePath, 'LOP.exe');
    
    return await fs.pathExists(exePath1) || await fs.pathExists(exePath2);
  } catch (error) {
    return false;
  }
});

ipcMain.handle('check-mod-installed', async (event, gamePath) => {
  try {
    console.log('Checking mod installation for game path:', gamePath);
    
    // Check multiple possible mods directories to handle different layouts/capitalization
    const possibleModDirs = [
      path.join(gamePath, 'LiesofP', 'Content', 'Paks', '~mods'),
      path.join(gamePath, 'LiesOfP', 'Content', 'Paks', '~mods'),
      path.join(gamePath, 'Content', 'Paks', '~mods')
    ];

    for (const modsPath of possibleModDirs) {
      console.log('Checking mods directory:', modsPath);
      
      try {
        const dubbingModPath = path.join(modsPath, '000_Spanishmod_P.pak');
        const musicModPath = path.join(modsPath, '000_SpanishMusicmod_P.pak');
        const locresModPath = path.join(modsPath, '000_SpanishLocresmod_P.pak');
        
        console.log('Checking paths:', { dubbingModPath, musicModPath, locresModPath });
        
        // Check if mods directory exists first
        const modsDirExists = await fs.pathExists(modsPath);
        console.log('Mods directory exists:', modsDirExists);
        
        if (modsDirExists) {
          const dubbingExists = await fs.pathExists(dubbingModPath);
          const musicExists = await fs.pathExists(musicModPath);
          const locresExists = await fs.pathExists(locresModPath);
          
          console.log('Mod files exist:', { dubbingExists, musicExists, locresExists });
          
          if (dubbingExists || musicExists || locresExists) {
            console.log('Found installed mods in:', modsPath);
            return true;
          }
        }
      } catch (pathError) {
        console.warn('Error checking path:', modsPath, pathError.message);
        continue;
      }
    }
    
    console.log('No mods found in any directory');
    return false;
  } catch (error) {
    console.error('Error in check-mod-installed:', error);
    return false;
  }
});

ipcMain.handle('install-dubbing', async (event, gamePath, installOptions = {}) => {
  try {
    const steps = [
      'Verificando archivos del juego...',
      'Descargando archivos (paralelo)...',
      'Creando backups de archivos existentes...',
      'Extrayendo archivos de cinemáticas...',
      'Extrayendo archivos de splash...',
      'Creando directorio de mods...',
      'Copiando archivo de doblaje...',
      'Limpiando archivos temporales...',
      'Finalizando instalación...'
    ];

    // Step 1: Verify game files
    mainWindow.webContents.send('installation-progress', {
      step: 1,
      total: steps.length,
      message: steps[0],
      percentage: 10
    });
    await new Promise(resolve => setTimeout(resolve, 500));

    // Create temporary directory for downloads
    const tempDir = path.join(os.tmpdir(), 'lies-of-p-installer');
    await fs.ensureDir(tempDir);

    // Define download URLs and paths
    const downloads = [
      {
        url: 'https://github.com/EcosDelDoblaje/LIESOFPESP/releases/download/V1.0/Cutscene.part1.rar',
        filename: 'Cutscene.part1.rar',
        step: 2
      },
      {
        url: 'https://github.com/EcosDelDoblaje/LIESOFPESP/releases/download/V1.0/Cutscene.part2.rar',
        filename: 'Cutscene.part2.rar',
        step: 3
      },
      {
        url: 'https://github.com/EcosDelDoblaje/LIESOFPESP/releases/download/V1.0/Splash.rar',
        filename: 'Splash.rar',
        step: 4
      }
    ];

    // Download files in parallel for better speed
    mainWindow.webContents.send('installation-progress', {
      step: 2,
      total: steps.length,
      message: 'Descargando archivos (3 descargas simultáneas)...',
      percentage: 20
    });

    // Track total download progress
    let totalDownloaded = 0;
    let totalSize = 0;
    const downloadProgress = {};

    const downloadPromises = downloads.map(async (download, index) => {
      const downloadPath = path.join(tempDir, download.filename);
      
      return downloadFile(download.url, downloadPath, (progress) => {
        downloadProgress[download.filename] = progress;
        
        // Calculate total progress
        let currentTotalDownloaded = 0;
        let currentTotalSize = 0;
        
        Object.values(downloadProgress).forEach(p => {
          currentTotalDownloaded += p.downloadedBytes;
          currentTotalSize += p.totalBytes || 0;
        });
        
        const overallSpeed = Object.values(downloadProgress)
          .reduce((sum, p) => sum + (p.speed || 0), 0);
        
        const downloaded = formatBytes(currentTotalDownloaded);
        const total = currentTotalSize > 0 ? formatBytes(currentTotalSize) : 'calculando...';
        const speed = formatSpeed(overallSpeed);
        
        let message = 'Descargando cinemáticas y contenido';
        if (currentTotalSize > 0) {
          message += ` - ${downloaded}/${total} (${speed})`;
        } else {
          message += ` - ${downloaded} (${speed})`;
        }
        
        mainWindow.webContents.send('installation-progress', {
          step: 2,
          total: steps.length,
          message: message,
          percentage: Math.round(20 + (currentTotalDownloaded / Math.max(currentTotalSize, 1)) * 20)
        });
      });
    });

    // Wait for all downloads to complete
    console.log('Waiting for downloads to complete...');
    await Promise.all(downloadPromises);
    console.log('All downloads completed successfully');
    
    // Add longer delay to ensure files are completely closed and released by the OS
    console.log('Waiting for files to be released by the system...');
    await new Promise(resolve => setTimeout(resolve, 5000)); // 5 seconds
    console.log('Files should be accessible now, proceeding to backup phase...');

    // Step 3: Create backups of existing files
    mainWindow.webContents.send('installation-progress', {
      step: 3,
      total: steps.length,
      message: steps[2],
      percentage: 40
    });

    const cutsceneDir = path.join(gamePath, 'LiesofP', 'Content', 'Movies', 'Cutscene');
    const splashDir = path.join(gamePath, 'LiesofP', 'Content', 'Movies', 'Splash');
    const backupDir = getBackupDir(gamePath);

    // Simple backup: backup entire directories if they exist
    if (await fs.pathExists(cutsceneDir)) {
      const cutsceneBackupDir = path.join(backupDir, 'Cutscene');
      await fs.ensureDir(cutsceneBackupDir);
      await fs.copy(cutsceneDir, cutsceneBackupDir, { overwrite: true });
      console.log('Cutscene directory backed up');
    }
    
    if (await fs.pathExists(splashDir)) {
      const splashBackupDir = path.join(backupDir, 'Splash');
      await fs.ensureDir(splashBackupDir);
      await fs.copy(splashDir, splashBackupDir, { overwrite: true });
      console.log('Splash directory backed up');
    }

    // Step 4: Extract cutscene files directly
    mainWindow.webContents.send('installation-progress', {
      step: 4,
      total: steps.length,
      message: steps[3],
      percentage: 55
    });

    await fs.ensureDir(cutsceneDir);
    console.log('About to extract cutscene RAR file...');
    console.log('RAR file path:', path.join(tempDir, 'Cutscene.part1.rar'));
    console.log('Extract to path:', cutsceneDir);
    console.log('Temp dir contents:', await fs.readdir(tempDir));
    
    await extractRarFile(path.join(tempDir, 'Cutscene.part1.rar'), cutsceneDir);
    console.log('Cutscene files extracted successfully');

    // Step 5: Extract splash files directly
    mainWindow.webContents.send('installation-progress', {
      step: 5,
      total: steps.length,
      message: steps[4],
      percentage: 65
    });

    await fs.ensureDir(splashDir);
    await extractRarFile(path.join(tempDir, 'Splash.rar'), splashDir);
    console.log('Splash files extracted successfully');

    // Step 6: Create mods directory
    mainWindow.webContents.send('installation-progress', {
      step: 6,
      total: steps.length,
      message: steps[5],
      percentage: 75
    });

    const modsPath = path.join(gamePath, 'LiesofP', 'Content', 'Paks', '~mods');
    await fs.ensureDir(modsPath);

    // Step 7: Copy mod file
    mainWindow.webContents.send('installation-progress', {
      step: 7,
      total: steps.length,
      message: steps[6],
      percentage: 80
    });

    // Install main dubbing mod
    const mainModPaths = [
      // Packaged app locations
      path.join(process.resourcesPath, 'app', 'assets', '000_Spanishmod_P.pak'),
      path.join(process.resourcesPath, 'assets', '000_Spanishmod_P.pak'),
      // Development locations
      path.join(__dirname, '..', 'assets', '000_Spanishmod_P.pak'),
      // Current directory
      path.join(process.cwd(), 'assets', '000_Spanishmod_P.pak')
    ];

    let sourceMainMod = null;
    console.log('Searching for main dubbing mod in the following locations:');
    for (const testPath of mainModPaths) {
      console.log('Checking:', testPath);
      if (await fs.pathExists(testPath)) {
        sourceMainMod = testPath;
        console.log('Found main mod file at:', sourceMainMod);
        break;
      }
    }

    if (!sourceMainMod) {
      console.log('Main mod file not found in any of the expected locations');
      throw new Error('No se encontró el archivo del mod de doblaje. Ubicaciones verificadas: ' + mainModPaths.join(', '));
    }

    const targetMainMod = path.join(modsPath, '000_Spanishmod_P.pak');
    await fs.copy(sourceMainMod, targetMainMod, { overwrite: true });

    // Set normal file permissions for main mod
    try {
      await fs.chmod(targetMainMod, 0o644);
      console.log('Main mod file permissions set successfully');
    } catch (permError) {
      console.warn('Could not set main mod file permissions:', permError.message);
    }

    console.log('Main mod file copied successfully to:', targetMainMod);

    // Install locres mod (always install if available)
    const locresModPaths = [
      // Packaged app locations
      path.join(process.resourcesPath, 'app', 'assets', '000_SpanishLocresmod_P.pak'),
      path.join(process.resourcesPath, 'assets', '000_SpanishLocresmod_P.pak'),
      // Development locations
      path.join(__dirname, '..', 'assets', '000_SpanishLocresmod_P.pak'),
      // Current directory
      path.join(process.cwd(), 'assets', '000_SpanishLocresmod_P.pak')
    ];

    let sourceLocresMod = null;
    console.log('Searching for locres mod in the following locations:');
    for (const testPath of locresModPaths) {
      console.log('Checking:', testPath);
      if (await fs.pathExists(testPath)) {
        sourceLocresMod = testPath;
        console.log('Found locres mod file at:', sourceLocresMod);
        break;
      }
    }

    if (sourceLocresMod) {
      const targetLocresMod = path.join(modsPath, '000_SpanishLocresmod_P.pak');
      await fs.copy(sourceLocresMod, targetLocresMod, { overwrite: true });

      // Set normal file permissions for locres mod
      try {
        await fs.chmod(targetLocresMod, 0o644);
        console.log('Locres mod file permissions set successfully');
      } catch (permError) {
        console.warn('Could not set locres mod file permissions:', permError.message);
      }

      console.log('Locres mod file copied successfully to:', targetLocresMod);
    } else {
      console.warn('Locres mod file not found, skipping locres installation');
    }

    // Install music mod if requested
    if (installOptions.installSongs) {
      const musicModPaths = [
        // Packaged app locations
        path.join(process.resourcesPath, 'app', 'assets', '000_SpanishMusicmod_P.pak'),
        path.join(process.resourcesPath, 'assets', '000_SpanishMusicmod_P.pak'),
        // Development locations
        path.join(__dirname, '..', 'assets', '000_SpanishMusicmod_P.pak'),
        // Current directory
        path.join(process.cwd(), 'assets', '000_SpanishMusicmod_P.pak')
      ];

      let sourceMusicMod = null;
      console.log('Searching for music mod in the following locations:');
      for (const testPath of musicModPaths) {
        console.log('Checking:', testPath);
        if (await fs.pathExists(testPath)) {
          sourceMusicMod = testPath;
          console.log('Found music mod file at:', sourceMusicMod);
          break;
        }
      }

      if (sourceMusicMod) {
        const targetMusicMod = path.join(modsPath, '000_SpanishMusicmod_P.pak');
        await fs.copy(sourceMusicMod, targetMusicMod, { overwrite: true });

        // Set normal file permissions for music mod
        try {
          await fs.chmod(targetMusicMod, 0o644);
          console.log('Music mod file permissions set successfully');
        } catch (permError) {
          console.warn('Could not set music mod file permissions:', permError.message);
        }

        console.log('Music mod file copied successfully to:', targetMusicMod);
      } else {
        console.warn('Music mod file not found, skipping music installation');
      }
    }

    // Step 8: Clean up temporary files
    mainWindow.webContents.send('installation-progress', {
      step: 8,
      total: steps.length,
      message: steps[7],
      percentage: 90
    });

    try {
      await fs.remove(tempDir);
      console.log('Temporary files cleaned up successfully');
    } catch (cleanupError) {
      console.warn('Could not clean up temporary files:', cleanupError.message);
    }

    // Step 9: Finalize installation
    mainWindow.webContents.send('installation-progress', {
      step: 9,
      total: steps.length,
      message: steps[8],
      percentage: 100
    });
    await new Promise(resolve => setTimeout(resolve, 500));

    if (!await fs.pathExists(targetMainMod)) {
      throw new Error('Error al verificar la instalación del archivo de doblaje');
    }

    return { 
      success: true, 
      installedPath: targetMainMod,
      message: 'Doblaje instalado correctamente'
    };
  } catch (error) {
    console.error('Installation error:', error);
    return { 
      success: false, 
      error: error.message || 'Error desconocido durante la instalación'
    };
  }
});

ipcMain.handle('launch-game', async () => {
  try {
    exec('start steam://rungameid/1627720');
    return true;
  } catch (error) {
    console.error('Error launching game:', error);
    return false;
  }
});

ipcMain.handle('uninstall-dubbing', async (event, gamePath) => {
  try {
    const steps = [
      'Verificando instalación actual...',
      'Eliminando archivo de doblaje...',
      'Restaurando archivos de cinemáticas originales...',
      'Restaurando archivos de splash originales...',
      'Limpiando directorios...',
      'Finalizando desinstalación...'
    ];

    // Step 1: Verify current installation
    mainWindow.webContents.send('installation-progress', {
      step: 1,
      total: steps.length,
      message: steps[0],
      percentage: 25
    });
    await new Promise(resolve => setTimeout(resolve, 500));

    // Find the actual mods directory and files
    const possibleModDirs = [
      path.join(gamePath, 'LiesofP', 'Content', 'Paks', '~mods'),
      path.join(gamePath, 'LiesOfP', 'Content', 'Paks', '~mods'),
      path.join(gamePath, 'Content', 'Paks', '~mods')
    ];
    
    let modsDir = null;
    let modFilesToRemove = [];
    
    for (const testDir of possibleModDirs) {
      if (await fs.pathExists(testDir)) {
        modsDir = testDir;
        
        // Check for dubbing mod
        const dubbingModPath = path.join(testDir, '000_Spanishmod_P.pak');
        if (await fs.pathExists(dubbingModPath)) {
          modFilesToRemove.push(dubbingModPath);
        }
        
        // Check for music mod
        const musicModPath = path.join(testDir, '000_SpanishMusicmod_P.pak');
        if (await fs.pathExists(musicModPath)) {
          modFilesToRemove.push(musicModPath);
        }
        
        // Check for locres mod
        const locresModPath = path.join(testDir, '000_SpanishLocresmod_P.pak');
        if (await fs.pathExists(locresModPath)) {
          modFilesToRemove.push(locresModPath);
        }
        
        break;
      }
    }

    if (modFilesToRemove.length === 0) {
      throw new Error('No se encontraron mods instalados para desinstalar');
    }

    // Step 2: Remove mod file
    mainWindow.webContents.send('installation-progress', {
      step: 2,
      total: steps.length,
      message: steps[1],
      percentage: 50
    });
    await new Promise(resolve => setTimeout(resolve, 500));

    // Remove all found mod files
    for (const modFile of modFilesToRemove) {
      console.log('Attempting to remove mod file:', modFile);
      
      try {
        // Verify file exists before attempting removal
        if (await fs.pathExists(modFile)) {
          // Try to change permissions before deletion to handle permission issues
          try {
            await fs.chmod(modFile, 0o666);
            console.log('Changed file permissions for deletion:', modFile);
          } catch (permError) {
            console.warn('Could not change file permissions for:', modFile, permError.message);
          }

          await fs.remove(modFile);
          console.log('Successfully removed:', modFile);
          
          // Verify the file was actually removed
          if (await fs.pathExists(modFile)) {
            console.error('File still exists after removal attempt:', modFile);
            throw new Error(`Failed to remove file: ${modFile}`);
          } else {
            console.log('Confirmed file removal:', modFile);
          }
        } else {
          console.log('File does not exist, skipping:', modFile);
        }
      } catch (removeError) {
        console.error('Error removing file:', modFile, removeError.message);
        throw new Error(`Failed to remove mod file: ${path.basename(modFile)} - ${removeError.message}`);
      }
    }

    // Step 3: Restore cutscene backups
    mainWindow.webContents.send('installation-progress', {
      step: 3,
      total: steps.length,
      message: steps[2],
      percentage: 50
    });

    const backupDir = getBackupDir(gamePath);
    const cutsceneBackupDir = path.join(backupDir, 'Cutscene');
    const cutsceneDir = path.join(gamePath, 'LiesofP', 'Content', 'Movies', 'Cutscene');

    if (await fs.pathExists(cutsceneBackupDir)) {
      try {
        // Remove current cutscene files
        if (await fs.pathExists(cutsceneDir)) {
          await fs.remove(cutsceneDir);
        }
        
        // Restore backup files
        const backupFiles = await fs.readdir(cutsceneBackupDir);
        for (const file of backupFiles) {
          const backupPath = path.join(cutsceneBackupDir, file);
          const targetPath = path.join(cutsceneDir, file);
          await restoreBackup(backupPath, targetPath);
        }
        console.log('Cutscene files restored from backup');
      } catch (error) {
        console.warn('Could not restore cutscene backups:', error.message);
      }
    }

    // Step 4: Restore splash backups
    mainWindow.webContents.send('installation-progress', {
      step: 4,
      total: steps.length,
      message: steps[3],
      percentage: 67
    });

    const splashBackupDir = path.join(backupDir, 'Splash');
    const splashDir = path.join(gamePath, 'LiesofP', 'Content', 'Movies', 'Splash');

    if (await fs.pathExists(splashBackupDir)) {
      try {
        // Remove current splash files
        if (await fs.pathExists(splashDir)) {
          await fs.remove(splashDir);
        }
        
        // Restore backup files
        const backupFiles = await fs.readdir(splashBackupDir);
        for (const file of backupFiles) {
          const backupPath = path.join(splashBackupDir, file);
          const targetPath = path.join(splashDir, file);
          await restoreBackup(backupPath, targetPath);
        }
        console.log('Splash files restored from backup');
      } catch (error) {
        console.warn('Could not restore splash backups:', error.message);
      }
    }

    // Step 5: Clean up directories if empty
    mainWindow.webContents.send('installation-progress', {
      step: 5,
      total: steps.length,
      message: steps[4],
      percentage: 83
    });
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check if mods directory is empty and remove it if so
    try {
      if (modsDir) {
        const modsContents = await fs.readdir(modsDir);
        if (modsContents.length === 0) {
          await fs.remove(modsDir);
          console.log('Removed empty mods directory:', modsDir);
        }
      }
    } catch (error) {
      // Directory might not exist or be inaccessible, which is fine
      console.log('Could not clean up mods directory:', error.message);
    }

    // Clean up backup directory after successful restoration
    try {
      if (await fs.pathExists(backupDir)) {
        await fs.remove(backupDir);
        console.log('Backup directory cleaned up:', backupDir);
      }
    } catch (error) {
      console.warn('Could not clean up backup directory:', error.message);
    }

    // Step 6: Finalize
    mainWindow.webContents.send('installation-progress', {
      step: 6,
      total: steps.length,
      message: steps[5],
      percentage: 100
    });
    await new Promise(resolve => setTimeout(resolve, 500));

    return { 
      success: true, 
      message: 'Doblaje desinstalado correctamente'
    };
  } catch (error) {
    console.error('Uninstallation error:', error);
    return { 
      success: false, 
      error: error.message || 'Error desconocido durante la desinstalación'
    };
  }
});

ipcMain.handle('open-external-link', async (event, url) => {
  try {
    await shell.openExternal(url);
    return true;
  } catch (error) {
    console.error('Error opening external link:', error);
    return false;
  }
});
