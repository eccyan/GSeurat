#!/usr/bin/env bash
# =============================================================================
# vulkan-game-tools Setup Script
# =============================================================================
# Installs dependencies, detects AI providers, and creates .env configuration.
# Usage: cd tools && ./setup.sh
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ---------------------------------------------------------------------------
# Colors & helpers
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m' # No Color

info()    { echo -e "${BLUE}[info]${NC}  $*"; }
success() { echo -e "${GREEN}[ok]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[warn]${NC}  $*"; }
error()   { echo -e "${RED}[err]${NC}   $*"; }
header()  { echo -e "\n${BOLD}${CYAN}==> $*${NC}"; }
dim()     { echo -e "${DIM}    $*${NC}"; }

# ---------------------------------------------------------------------------
# 1. Check prerequisites
# ---------------------------------------------------------------------------
header "Checking prerequisites"

# Node.js
if command -v node &>/dev/null; then
  NODE_VER=$(node --version)
  success "Node.js $NODE_VER"
  # Check minimum version (18+)
  MAJOR=$(echo "$NODE_VER" | sed 's/v//' | cut -d. -f1)
  if [ "$MAJOR" -lt 18 ]; then
    warn "Node.js 18+ recommended. You have $NODE_VER"
  fi
else
  error "Node.js not found. Install from https://nodejs.org/ (v18+)"
  exit 1
fi

# pnpm
if command -v pnpm &>/dev/null; then
  PNPM_VER=$(pnpm --version)
  success "pnpm $PNPM_VER"
else
  warn "pnpm not found. Installing via corepack..."
  if command -v corepack &>/dev/null; then
    corepack enable
    corepack prepare pnpm@latest --activate
    success "pnpm installed via corepack"
  else
    warn "corepack not available. Installing pnpm via npm..."
    npm install -g pnpm
    success "pnpm installed via npm"
  fi
fi

# ---------------------------------------------------------------------------
# 2. Install dependencies
# ---------------------------------------------------------------------------
header "Installing dependencies"

pnpm install
success "pnpm install complete"

# ---------------------------------------------------------------------------
# 3. Build bridge (required for engine communication)
# ---------------------------------------------------------------------------
header "Building bridge proxy"

(cd apps/bridge && pnpm build)
success "Bridge built"

# ---------------------------------------------------------------------------
# 4. Detect & configure AI providers
# ---------------------------------------------------------------------------
header "Detecting AI providers"

OLLAMA_URL="http://localhost:11434"
OLLAMA_MODEL="llama3"
COMFYUI_URL="http://localhost:8188"
AUDIOCRAFT_URL="http://localhost:8001"

OLLAMA_OK=false
COMFYUI_OK=false
AUDIOCRAFT_OK=false

# --- Ollama ------------------------------------------------------------------
check_ollama() {
  if curl -sf "${OLLAMA_URL}/api/tags" -o /dev/null --connect-timeout 2; then
    return 0
  fi
  return 1
}

if command -v ollama &>/dev/null; then
  success "Ollama CLI found: $(command -v ollama)"

  if check_ollama; then
    OLLAMA_OK=true
    success "Ollama server is running at $OLLAMA_URL"

    # Check if model is available
    MODELS=$(curl -sf "${OLLAMA_URL}/api/tags" 2>/dev/null | grep -o '"name":"[^"]*"' | sed 's/"name":"//;s/"//' || true)
    if [ -n "$MODELS" ]; then
      dim "Available models: $(echo "$MODELS" | tr '\n' ', ' | sed 's/,$//')"

      # Check for default model
      if echo "$MODELS" | grep -q "^${OLLAMA_MODEL}"; then
        success "Default model '${OLLAMA_MODEL}' is available"
      else
        warn "Default model '${OLLAMA_MODEL}' not found"
        # Pick first available or ask to pull
        FIRST_MODEL=$(echo "$MODELS" | head -1 | cut -d: -f1)
        if [ -n "$FIRST_MODEL" ]; then
          echo -e "    Available: $MODELS"
          read -rp "    Use '$FIRST_MODEL' instead? (Y/n) " USE_FIRST
          if [[ "${USE_FIRST:-y}" =~ ^[Yy]$ ]]; then
            OLLAMA_MODEL="$FIRST_MODEL"
            success "Using model: $OLLAMA_MODEL"
          fi
        fi

        read -rp "    Pull '${OLLAMA_MODEL}' now? (Y/n) " PULL_MODEL
        if [[ "${PULL_MODEL:-y}" =~ ^[Yy]$ ]]; then
          info "Pulling ${OLLAMA_MODEL}... (this may take a while)"
          ollama pull "$OLLAMA_MODEL"
          success "Model ${OLLAMA_MODEL} pulled"
        fi
      fi
    else
      warn "No models found. Pull one with: ollama pull llama3"
      read -rp "    Pull 'llama3' now? (Y/n) " PULL_NOW
      if [[ "${PULL_NOW:-y}" =~ ^[Yy]$ ]]; then
        info "Pulling llama3... (this may take a while)"
        ollama pull llama3
        success "Model llama3 pulled"
      fi
    fi
  else
    warn "Ollama installed but server not running"
    read -rp "    Start Ollama server now? (Y/n) " START_OLLAMA
    if [[ "${START_OLLAMA:-y}" =~ ^[Yy]$ ]]; then
      info "Starting Ollama server in background..."
      ollama serve &>/dev/null &
      sleep 2
      if check_ollama; then
        OLLAMA_OK=true
        success "Ollama server started"

        # Check/pull model
        if ! curl -sf "${OLLAMA_URL}/api/tags" 2>/dev/null | grep -q "\"${OLLAMA_MODEL}\""; then
          read -rp "    Pull '${OLLAMA_MODEL}' now? (Y/n) " PULL_NOW
          if [[ "${PULL_NOW:-y}" =~ ^[Yy]$ ]]; then
            ollama pull "$OLLAMA_MODEL"
            success "Model pulled"
          fi
        fi
      else
        warn "Failed to start Ollama server"
      fi
    fi
  fi
else
  warn "Ollama not installed"
  echo ""
  echo -e "    ${BOLD}Ollama${NC} provides local LLM for Level Designer, Keyframe Animator,"
  echo -e "    and Particle Designer AI features."
  echo ""

  if [[ "$OSTYPE" == "darwin"* ]]; then
    echo -e "    Install options:"
    echo -e "      ${CYAN}brew install ollama${NC}"
    echo -e "      ${CYAN}curl -fsSL https://ollama.com/install.sh | sh${NC}"
    echo ""
    if command -v brew &>/dev/null; then
      read -rp "    Install Ollama via Homebrew? (Y/n) " INSTALL_OLLAMA
      if [[ "${INSTALL_OLLAMA:-y}" =~ ^[Yy]$ ]]; then
        brew install ollama
        success "Ollama installed"
        info "Starting Ollama server..."
        ollama serve &>/dev/null &
        sleep 3
        if check_ollama; then
          OLLAMA_OK=true
          success "Ollama server running"
          read -rp "    Pull 'llama3' model? (Y/n) " PULL_NOW
          if [[ "${PULL_NOW:-y}" =~ ^[Yy]$ ]]; then
            ollama pull llama3
            success "Model pulled"
          fi
        fi
      fi
    fi
  elif [[ "$OSTYPE" == "linux"* ]]; then
    echo -e "    Install: ${CYAN}curl -fsSL https://ollama.com/install.sh | sh${NC}"
    read -rp "    Install Ollama now? (Y/n) " INSTALL_OLLAMA
    if [[ "${INSTALL_OLLAMA:-y}" =~ ^[Yy]$ ]]; then
      curl -fsSL https://ollama.com/install.sh | sh
      success "Ollama installed"
      ollama serve &>/dev/null &
      sleep 3
      if check_ollama; then
        OLLAMA_OK=true
        read -rp "    Pull 'llama3' model? (Y/n) " PULL_NOW
        if [[ "${PULL_NOW:-y}" =~ ^[Yy]$ ]]; then
          ollama pull llama3
          success "Model pulled"
        fi
      fi
    fi
  fi
fi

echo ""

# --- ComfyUI -----------------------------------------------------------------
if curl -sf "${COMFYUI_URL}/system_stats" -o /dev/null --connect-timeout 2; then
  COMFYUI_OK=true
  success "ComfyUI is running at $COMFYUI_URL"
else
  warn "ComfyUI not detected at $COMFYUI_URL"
  dim "ComfyUI provides Stable Diffusion for Pixel Painter AI generation."
  dim "Install: https://github.com/comfyanonymous/ComfyUI"
  dim "Start:   python main.py --listen"

  read -rp "    Enter custom ComfyUI URL (or press Enter to skip): " CUSTOM_COMFYUI
  if [ -n "$CUSTOM_COMFYUI" ]; then
    COMFYUI_URL="$CUSTOM_COMFYUI"
    if curl -sf "${COMFYUI_URL}/system_stats" -o /dev/null --connect-timeout 2; then
      COMFYUI_OK=true
      success "ComfyUI found at $COMFYUI_URL"
    else
      warn "ComfyUI not responding at $COMFYUI_URL (saved anyway)"
    fi
  fi
fi

echo ""

# --- AudioCraft ---------------------------------------------------------------
if curl -sf "${AUDIOCRAFT_URL}/health" -o /dev/null --connect-timeout 2; then
  AUDIOCRAFT_OK=true
  success "AudioCraft is running at $AUDIOCRAFT_URL"
else
  warn "AudioCraft not detected at $AUDIOCRAFT_URL"
  dim "AudioCraft provides music/SFX generation for Audio Composer & SFX Designer."
  dim "Install: pip install audiocraft"
  dim "Start:   python -m audiocraft.server"

  read -rp "    Enter custom AudioCraft URL (or press Enter to skip): " CUSTOM_AUDIOCRAFT
  if [ -n "$CUSTOM_AUDIOCRAFT" ]; then
    AUDIOCRAFT_URL="$CUSTOM_AUDIOCRAFT"
    if curl -sf "${AUDIOCRAFT_URL}/health" -o /dev/null --connect-timeout 2; then
      AUDIOCRAFT_OK=true
      success "AudioCraft found at $AUDIOCRAFT_URL"
    else
      warn "AudioCraft not responding at $AUDIOCRAFT_URL (saved anyway)"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 5. Write .env
# ---------------------------------------------------------------------------
header "Writing .env configuration"

ENV_FILE="$SCRIPT_DIR/.env"

cat > "$ENV_FILE" <<EOF
# =============================================================================
# vulkan-game-tools AI Provider Configuration
# Generated by setup.sh on $(date '+%Y-%m-%d %H:%M:%S')
# =============================================================================

# --- Ollama (LLM) -----------------------------------------------------------
# Used by: Level Designer, Keyframe Animator, Particle Designer
VITE_OLLAMA_URL=${OLLAMA_URL}
VITE_OLLAMA_MODEL=${OLLAMA_MODEL}

# --- ComfyUI (Stable Diffusion) ---------------------------------------------
# Used by: Pixel Painter
VITE_COMFYUI_URL=${COMFYUI_URL}

# --- AudioCraft (Music/SFX Generation) --------------------------------------
# Used by: Audio Composer, SFX Designer
VITE_AUDIOCRAFT_URL=${AUDIOCRAFT_URL}
EOF

success "Configuration written to tools/.env"

# ---------------------------------------------------------------------------
# 6. Summary
# ---------------------------------------------------------------------------
header "Setup complete!"

echo ""
echo -e "  ${BOLD}AI Provider Status:${NC}"
if $OLLAMA_OK; then
  echo -e "    ${GREEN}*${NC} Ollama      ${GREEN}ready${NC}  (model: ${OLLAMA_MODEL})"
else
  echo -e "    ${RED}*${NC} Ollama      ${DIM}not running${NC}  ${DIM}(Level Designer, Keyframe Animator, Particle Designer)${NC}"
fi
if $COMFYUI_OK; then
  echo -e "    ${GREEN}*${NC} ComfyUI     ${GREEN}ready${NC}"
else
  echo -e "    ${RED}*${NC} ComfyUI     ${DIM}not running${NC}  ${DIM}(Pixel Painter)${NC}"
fi
if $AUDIOCRAFT_OK; then
  echo -e "    ${GREEN}*${NC} AudioCraft  ${GREEN}ready${NC}"
else
  echo -e "    ${RED}*${NC} AudioCraft  ${DIM}not running${NC}  ${DIM}(Audio Composer, SFX Designer)${NC}"
fi

echo ""
echo -e "  ${BOLD}Quick Start:${NC}"
echo -e "    ${DIM}# Terminal 1: Start the game engine${NC}"
echo -e "    ${CYAN}cd build/macos-debug && ./vulkan_game${NC}"
echo ""
echo -e "    ${DIM}# Terminal 2: Start the bridge proxy${NC}"
echo -e "    ${CYAN}cd tools/apps/bridge && pnpm start${NC}"
echo ""
echo -e "    ${DIM}# Terminal 3: Start a tool (e.g. Level Designer)${NC}"
echo -e "    ${CYAN}cd tools/apps/level-designer && pnpm dev${NC}"
echo ""
echo -e "  ${BOLD}All tools:${NC}"
echo -e "    Level Designer       ${CYAN}http://localhost:5173${NC}  (Ollama)"
echo -e "    Pixel Painter        ${CYAN}http://localhost:5174${NC}  (ComfyUI)"
echo -e "    Keyframe Animator    ${CYAN}http://localhost:5175${NC}  (Ollama)"
echo -e "    Particle Designer    ${CYAN}http://localhost:5176${NC}  (Ollama)"
echo -e "    Audio Composer       ${CYAN}http://localhost:5177${NC}  (AudioCraft)"
echo -e "    SFX Designer         ${CYAN}http://localhost:5178${NC}  (AudioCraft)"
echo ""
echo -e "  ${DIM}Edit tools/.env to change AI provider URLs/models.${NC}"
echo ""
