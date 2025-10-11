console.log('Renderer script loaded');

// Access the secure API exposed by preload.js
let api;

// Screen management
let currentScreen = 0;
const screens = ['welcome-screen', 'reinstall-screen', 'terms-screen', 'path-screen', 'progress-screen', 'complete-screen'];

// State
let selectedGamePath = '';
let isInstalling = false;
let installSongs = true; // Default to true (checked)
let isModInstalled = false;
let startupModStatus = null;

// Initialize everything when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Access the secure API exposed by preload.js
    api = window.electronAPI;
    console.log('electronAPI from window:', api);
    
    // Verify api is available
    if (!api) {
        console.error('api not available. Check preload.js configuration.');
        return;
    } else {
        console.log('api is available');
    }
    
    // Initialize event listeners and check startup status
    initializeEventListeners();
    checkStartupModStatus();
});

function initializeEventListeners() {
    console.log('Initializing event listeners...');
    
    // Window controls
    const minimizeBtn = document.getElementById('minimize-btn');
    const closeBtn = document.getElementById('close-btn');
    const nextBtn = document.getElementById('next-btn');
    
    console.log('Found elements:', { minimizeBtn, closeBtn, nextBtn });
    
    if (minimizeBtn) {
        minimizeBtn.addEventListener('click', () => {
            console.log('Minimize button clicked');
            api.minimizeWindow();
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            console.log('Close button clicked');
            api.closeWindow();
        });
    }

    // Welcome screen
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            console.log('Next button clicked, startupModStatus:', startupModStatus);
            if (startupModStatus && startupModStatus.found && startupModStatus.modInstalled) {
                // If mod is installed, go directly to uninstall
                selectedGamePath = startupModStatus.gamePath;
                isModInstalled = true;
                startDirectUninstall();
            } else {
                console.log('Going to terms screen');
                showScreen(2); // Go to terms screen
            }
        });
    } else {
        console.error('next-btn element not found!');
    }

    // Reinstall button
    document.getElementById('reinstall-btn').addEventListener('click', () => {
        if (startupModStatus && startupModStatus.found) {
            selectedGamePath = startupModStatus.gamePath;
            isModInstalled = true;
            showReinstallOptions();
        }
    });

    // Terms screen
    document.getElementById('terms-back-btn').addEventListener('click', () => {
        showScreen(0); // Back to welcome
    });
    
    document.getElementById('accept-terms-btn').addEventListener('click', () => {
        showScreen(3); // Go to path selection
    });

    // Reinstall screen
    document.getElementById('reinstall-back-btn').addEventListener('click', () => {
        showScreen(0); // Back to welcome
    });
    
    document.getElementById('confirm-reinstall-btn').addEventListener('click', () => {
        const reinstallSongs = document.getElementById('reinstall-songs').checked;
        startDirectReinstall(reinstallSongs);
    });

    // Terms scroll detection
    const termsScroll = document.querySelector('.terms-scroll');
    const acceptBtn = document.getElementById('accept-terms-btn');
    
    if (termsScroll && acceptBtn) {
        termsScroll.addEventListener('scroll', () => {
            const scrollTop = termsScroll.scrollTop;
            const scrollHeight = termsScroll.scrollHeight;
            const clientHeight = termsScroll.clientHeight;
            
            // Check if user has scrolled to the bottom (with 10px tolerance)
            if (scrollTop + clientHeight >= scrollHeight - 10) {
                acceptBtn.classList.remove('disabled');
                acceptBtn.disabled = false;
            }
        });
    }

    // Path selection screen
    document.getElementById('browse-btn').addEventListener('click', browseFolder);
    document.getElementById('back-btn').addEventListener('click', () => {
        showScreen(2); // Back to terms screen
    });
    document.getElementById('install-btn').addEventListener('click', startInstallation);

    // Installation options
    document.getElementById('install-songs').addEventListener('change', (e) => {
        installSongs = e.target.checked;
    });

    // Complete screen
    document.getElementById('play-btn').addEventListener('click', launchGame);
    document.getElementById('finish-btn').addEventListener('click', () => {
        api.closeWindow();
    });

    // External links
    document.querySelectorAll('a[href^="http"]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            api.openExternalLink(link.href);
        });
    });

    // Installation progress listener
    api.onInstallationProgress((data) => {
        updateProgress(data);
    });
}

function showScreen(screenIndex) {
    // Remove active class from all screens
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active', 'prev');
    });

    // Add prev class to previous screens
    for (let i = 0; i < screenIndex; i++) {
        document.getElementById(screens[i]).classList.add('prev');
    }

    // Show current screen
    document.getElementById(screens[screenIndex]).classList.add('active');
    currentScreen = screenIndex;
    
    // Auto-detect Steam path when showing path selection screen
    if (screenIndex === 3) { // path-screen is index 3
        autoDetectSteamPath();
    }
}

async function autoDetectSteamPath() {
    const detectInfo = document.getElementById('detection-status');
    const icon = document.querySelector('.detect-info .icon');
    
    detectInfo.textContent = 'Detectando automáticamente el juego (Steam, Epic, Microsoft Store)...';
    icon.style.color = '#dc2626';
    
    try {
        const path = await api.detectSteamPath();
        
        if (path) {
            selectedGamePath = path;
            document.getElementById('game-path').value = path;
            detectInfo.textContent = '¡Lies of P encontrado automáticamente!';
            enableInstallButton();
            
            // Show success animation
            icon.innerHTML = `<path d="M9 12L11 14L15 10M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
            icon.style.color = '#10b981';
        } else {
            detectInfo.innerHTML = 'No se pudo detectar automáticamente. <button onclick="autoDetectSteamPath()" style="background: none; border: none; color: #3b82f6; text-decoration: underline; cursor: pointer; font-size: inherit;">Reintentar</button> o selecciona la carpeta manualmente.';
            icon.innerHTML = `<path d="M12 9V13M12 17H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
            icon.style.color = '#f59e0b';
            showError('Juego no detectado automáticamente. Verifica que Lies of P esté instalado en Steam, Epic Games Store, Microsoft Store o manualmente.', 'warning');
        }
    } catch (error) {
        console.error('Error detecting Steam path:', error);
        detectInfo.textContent = 'Error en la detección automática. Selecciona la carpeta manualmente.';
        icon.innerHTML = `<path d="M12 9V13M12 17H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
        icon.style.color = '#dc2626';
        showError('Error en la detección automática. Por favor, selecciona la carpeta manualmente.', 'error');
    }
}

async function browseFolder() {
    try {
        const path = await api.browseFolder();
        
        if (path) {
            const isValid = await api.validateGamePath(path);
            
            if (isValid) {
                selectedGamePath = path;
                document.getElementById('game-path').value = path;
                enableInstallButton();
            } else {
                showError('La carpeta seleccionada no contiene Lies of P. Busca la carpeta que contenga "LiesOfP.exe" o "LOP.exe".', 'warning');
            }
        }
    } catch (error) {
        console.error('Error browsing folder:', error);
        showError('Error al seleccionar la carpeta.');
    }
}

async function enableInstallButton() {
    const installBtn = document.getElementById('install-btn');
    
    // Check if mod is already installed
    isModInstalled = await api.checkModInstalled(selectedGamePath);
    
    if (isModInstalled) {
        installBtn.innerHTML = `
            <span>Desinstalar</span>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M3 6H5H21M8 6V4C8 3.44772 8.44772 3 9 3H15C15.5523 3 16 3.44772 16 4V6M19 6V20C19 20.5523 18.4477 21 18 21H6C5.44772 21 5 20.5523 5 20V6H19ZM10 11V17M14 11V17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `;
        installBtn.style.background = 'linear-gradient(135deg, #dc2626, #b91c1c)';
    } else {
        installBtn.innerHTML = `
            <span>Instalar</span>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M9 18L15 12L9 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `;
        installBtn.style.background = 'linear-gradient(135deg, #dc2626, #b91c1c)';
    }
    
    installBtn.classList.remove('disabled');
    installBtn.disabled = false;
}

async function startInstallation() {
    console.log('startInstallation called');
    console.log('selectedGamePath:', selectedGamePath);
    console.log('isInstalling:', isInstalling);
    console.log('isModInstalled:', isModInstalled);
    
    if (!selectedGamePath) {
        showError('Por favor, selecciona primero la ruta del juego usando la detección automática o el botón "Examinar".', 'warning');
        return;
    }
    
    if (isInstalling) {
        console.log('Installation already in progress');
        return;
    }
    
    isInstalling = true;
    console.log('Starting installation/uninstallation, going to progress screen');
    
    // Update progress screen title
    const progressTitle = document.querySelector('#progress-screen .screen-title');
    if (progressTitle) {
        progressTitle.textContent = isModInstalled ? 'Desinstalando Doblaje' : 'Instalando Doblaje';
    }
    
    showScreen(4); // Progress screen is index 4
    
    try {
        let result;
        
        if (isModInstalled) {
            // Uninstall the mod
            result = await api.uninstallDubbing(selectedGamePath);
        } else {
            // Install the mod
            const installOptions = {
                installSongs: installSongs
            };
            result = await api.installDubbing(selectedGamePath, installOptions);
        }
        
        if (result.success) {
            setTimeout(() => {
                showScreen(5); // Complete screen is index 5
                updateCompleteScreen(isModInstalled);
            }, 1000);
        } else {
            showError(`Error durante la ${isModInstalled ? 'desinstalación' : 'instalación'}: ` + result.error);
            showScreen(3); // Back to path selection (index 3)
        }
    } catch (error) {
        console.error('Installation/Uninstallation error:', error);
        showError(`Error inesperado durante la ${isModInstalled ? 'desinstalación' : 'instalación'}.`);
        showScreen(3); // Back to path selection (index 3)
    }
    
    isInstalling = false;
}

function updateProgress(data) {
    const progressFill = document.querySelector('.progress-fill');
    const progressMessage = document.querySelector('.progress-message');
    const progressStep = document.querySelector('.progress-step');
    const progressPercentage = document.querySelector('.progress-percentage');
    
    progressFill.style.width = data.percentage + '%';
    progressMessage.textContent = data.message;
    progressStep.textContent = `Paso ${data.step} de ${data.total}`;
    progressPercentage.textContent = data.percentage + '%';
}

async function launchGame() {
    try {
        const launched = await api.launchGame();
        
        if (launched) {
            // Close installer after launching game
            setTimeout(() => {
                api.closeWindow();
            }, 2000);
        } else {
            showError('No se pudo abrir el juego. Ábrelo manualmente desde Steam.');
        }
    } catch (error) {
        console.error('Error launching game:', error);
        showError('Error al abrir el juego.');
    }
}

function updateCompleteScreen(wasUninstall) {
    const successTitle = document.querySelector('.success-title');
    const successMessage = document.querySelector('.success-message');
    const progressTitle = document.querySelector('.screen-title');
    
    if (wasUninstall) {
        successTitle.textContent = '¡Desinstalación Completa!';
        successMessage.innerHTML = 'El doblaje al castellano se ha desinstalado correctamente.<br>El juego volverá a usar el audio original.';
        
        // Update progress screen title for next time
        if (progressTitle && progressTitle.textContent.includes('Instalando')) {
            progressTitle.textContent = 'Desinstalando Doblaje';
        }
    } else {
        successTitle.textContent = '¡Instalación Completa!';
        successMessage.innerHTML = 'El doblaje al castellano se ha instalado correctamente.<br>¡Disfruta de Lies of P en español!';
        
        // Update progress screen title for next time
        if (progressTitle && progressTitle.textContent.includes('Desinstalando')) {
            progressTitle.textContent = 'Instalando Doblaje';
        }
    }
}

async function checkStartupModStatus() {
    console.log('checkStartupModStatus called');
    try {
        if (!api) {
            console.error('api not available in checkStartupModStatus');
            showScreen(0);
            return;
        }
        
        console.log('Calling api.checkStartupModStatus...');
        startupModStatus = await api.checkStartupModStatus();
        console.log('Startup mod status result:', startupModStatus);
        
        if (startupModStatus.found && startupModStatus.modInstalled) {
            // Update welcome screen for uninstall
            updateWelcomeForUninstall();
        }
        
        showScreen(0); // Show welcome screen after checking
    } catch (error) {
        console.error('Error checking startup mod status:', error);
        showScreen(0); // Show welcome screen anyway
    }
}

function updateWelcomeForUninstall() {
    const description = document.getElementById('welcome-description');
    const nextBtn = document.getElementById('next-btn');
    const reinstallBtn = document.getElementById('reinstall-btn');
    
    // Create description based on what mods are installed
    let descriptionText = 'Se ha detectado que hay mods instalados.';
    if (startupModStatus.installedMods) {
        const { dubbing, music, locres } = startupModStatus.installedMods;
        const installedComponents = [];
        if (dubbing) installedComponents.push('doblaje');
        if (music) installedComponents.push('música');
        if (locres) installedComponents.push('textos');
        
        if (installedComponents.length > 0) {
            if (installedComponents.length === 1) {
                descriptionText = `Se ha detectado que ${installedComponents[0]} está instalado.`;
            } else if (installedComponents.length === 2) {
                descriptionText = `Se ha detectado que ${installedComponents[0]} y ${installedComponents[1]} están instalados.`;
            } else {
                descriptionText = `Se ha detectado que ${installedComponents[0]}, ${installedComponents[1]} y ${installedComponents[2]} están instalados.`;
            }
        }
    }
    
    description.innerHTML = `<p>${descriptionText}<br>¿Deseas desinstalarlo o reinstalarlo?</p>`;
    
    nextBtn.innerHTML = `
        <span>Desinstalar</span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M3 6H5H21M8 6V4C8 3.44772 8.44772 3 9 3H15C15.5523 3 16 3.44772 16 4V6M19 6V20C19 20.5523 18.4477 21 18 21H6C5.44772 21 5 20.5523 5 20V6H19ZM10 11V17M14 11V17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `;
    nextBtn.style.background = 'linear-gradient(135deg, #dc2626, #b91c1c)';
    
    // Show the reinstall button
    reinstallBtn.style.display = 'inline-flex';
}

async function startDirectUninstall() {
    isInstalling = true;
    
    // Update progress screen title
    const progressTitle = document.querySelector('#progress-screen .screen-title');
    if (progressTitle) {
        progressTitle.textContent = 'Desinstalando Doblaje';
    }
    
    showScreen(4); // Go directly to progress screen
    
    try {
        const result = await api.uninstallDubbing(selectedGamePath);
        
        if (result.success) {
            setTimeout(() => {
                showScreen(5); // Complete screen
                updateCompleteScreen(true); // true = was uninstall
            }, 1000);
        } else {
            showError('Error durante la desinstalación: ' + result.error);
            showScreen(0); // Back to welcome
        }
    } catch (error) {
        console.error('Uninstallation error:', error);
        showError('Error inesperado durante la desinstalación.');
        showScreen(0); // Back to welcome
    }
    
    isInstalling = false;
}

function showReinstallOptions() {
    // Update current status based on installed mods
    const currentStatus = document.getElementById('current-status');
    const reinstallSongsCheckbox = document.getElementById('reinstall-songs');
    
    if (startupModStatus.installedMods) {
        const { dubbing, music, locres } = startupModStatus.installedMods;
        let statusHTML = '<div class="status-items">';
        
        if (dubbing) {
            statusHTML += '<div class="status-item installed"><span class="status-icon">✓</span> Doblaje al castellano instalado</div>';
        } else {
            statusHTML += '<div class="status-item not-installed"><span class="status-icon">✗</span> Doblaje al castellano no instalado</div>';
        }
        
        if (locres) {
            statusHTML += '<div class="status-item installed"><span class="status-icon">✓</span> Textos en español instalados</div>';
        } else {
            statusHTML += '<div class="status-item not-installed"><span class="status-icon">✗</span> Textos en español no instalados</div>';
        }
        
        if (music) {
            statusHTML += '<div class="status-item installed"><span class="status-icon">✓</span> Canciones en español instaladas</div>';
            reinstallSongsCheckbox.checked = true;
        } else {
            statusHTML += '<div class="status-item not-installed"><span class="status-icon">✗</span> Canciones en español no instaladas</div>';
            reinstallSongsCheckbox.checked = false;
        }
        
        statusHTML += '</div>';
        currentStatus.innerHTML = statusHTML;
    }
    
    showScreen(1); // Show reinstall screen
}

async function startDirectReinstall(shouldInstallSongs = false) {
    selectedGamePath = startupModStatus.gamePath;
    isModInstalled = false; // Set to false to trigger installation
    installSongs = shouldInstallSongs; // Update global variable with user choice
    isInstalling = true;
    
    // Update progress screen title for reinstall
    const progressTitle = document.querySelector('#progress-screen .screen-title');
    if (progressTitle) {
        progressTitle.textContent = 'Reinstalando Doblaje';
    }
    
    showScreen(4); // Go directly to progress screen
    
    try {
        const installOptions = {
            installSongs: installSongs
        };
        const result = await api.installDubbing(selectedGamePath, installOptions);
        
        if (result.success) {
            setTimeout(() => {
                showScreen(5); // Complete screen
                updateCompleteScreen(false); // false = was install/reinstall
            }, 1000);
        } else {
            showError('Error durante la reinstalación: ' + result.error);
            showScreen(0); // Back to welcome
        }
    } catch (error) {
        console.error('Reinstallation error:', error);
        showError('Error inesperado durante la reinstalación.');
        showScreen(0); // Back to welcome
    }
    
    isInstalling = false;
}

function showError(message, type = 'error') {
    // Create error notification
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-notification';
    
    // Different icons and colors for different types
    let iconSvg, backgroundColor;
    switch (type) {
        case 'warning':
            iconSvg = `<path d="M12 9V13M12 17H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
            backgroundColor = 'rgba(245, 158, 11, 0.9)';
            break;
        case 'info':
            iconSvg = `<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M12 16V12M12 8H12.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
            backgroundColor = 'rgba(59, 130, 246, 0.9)';
            break;
        default: // error
            iconSvg = `<path d="M12 9V13M12 17H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
            backgroundColor = 'rgba(220, 38, 38, 0.9)';
    }
    
    errorDiv.innerHTML = `
        <div class="error-content">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                ${iconSvg}
            </svg>
            <span>${message}</span>
            <button onclick="this.parentElement.parentElement.remove()">×</button>
        </div>
    `;
    
    // Add error styles
    errorDiv.style.cssText = `
        position: fixed;
        top: 50px;
        right: 20px;
        background: ${backgroundColor};
        color: white;
        padding: 16px;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        z-index: 1000;
        max-width: 400px;
        backdrop-filter: blur(10px);
        animation: slideInRight 0.3s ease;
    `;
    
    errorDiv.querySelector('.error-content').style.cssText = `
        display: flex;
        align-items: flex-start;
        gap: 12px;
        line-height: 1.4;
    `;
    
    errorDiv.querySelector('button').style.cssText = `
        background: none;
        border: none;
        color: white;
        font-size: 20px;
        cursor: pointer;
        padding: 0;
        margin-left: auto;
        flex-shrink: 0;
    `;
    
    document.body.appendChild(errorDiv);
    
    // Auto remove after longer time for warnings and info
    const timeout = type === 'error' ? 5000 : (type === 'warning' ? 7000 : 6000);
    setTimeout(() => {
        if (errorDiv.parentElement) {
            errorDiv.remove();
        }
    }, timeout);
}

// Add smooth transitions and animations
document.addEventListener('DOMContentLoaded', () => {
    // Add entrance animation to elements
    const animateElements = document.querySelectorAll('.primary-button, .secondary-button, .screen-title');
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.animation = 'fadeInUp 0.6s ease forwards';
            }
        });
    });
    
    animateElements.forEach(el => observer.observe(el));
});

// Add CSS for animations
const style = document.createElement('style');
style.textContent = `
    @keyframes fadeInUp {
        from {
            opacity: 0;
            transform: translateY(30px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
    
    .error-notification {
        animation: slideInRight 0.3s ease;
    }
    
    @keyframes slideInRight {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
`;
document.head.appendChild(style);

// Make functions globally available for inline onclick handlers
window.autoDetectSteamPath = autoDetectSteamPath;
