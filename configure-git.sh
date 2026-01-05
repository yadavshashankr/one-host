#!/bin/bash

# Git Configuration Script for One-Host
# This script configures Git to use the token for both repositories

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to read token from file
get_token() {
    if [ -f ".git-token" ]; then
        # Extract token from the file
        TOKEN=$(grep "GITHUB_TOKEN=" .git-token | cut -d'=' -f2)
        echo "$TOKEN"
    else
        print_error "Token file .git-token not found!"
        exit 1
    fi
}

# Function to configure repository with token
configure_repo() {
    local repo_name=$1
    local repo_url=$2
    local token=$3
    
    print_status "Configuring $repo_name repository..."
    
    # Create the URL with token
    if [ "$repo_name" = "dev" ]; then
        local token_url="https://${token}@github.com/yadavshashankr/one-host-develop.git"
    elif [ "$repo_name" = "prod" ]; then
        local token_url="https://${token}@github.com/yadavshashankr/one-host.git"
    else
        local token_url="https://${token}@github.com/yadavshashankr/${repo_name}.git"
    fi
    
    # Add remote if it doesn't exist, or update if it does
    if git remote get-url "$repo_name" >/dev/null 2>&1; then
        git remote set-url "$repo_name" "$token_url"
        print_success "Updated $repo_name remote with token"
    else
        git remote add "$repo_name" "$token_url"
        print_success "Added $repo_name remote with token"
    fi
    
    echo "  Repository: $repo_url"
    echo "  Remote name: $repo_name"
}

# Main configuration function
configure_git() {
    print_status "Configuring Git with GitHub token..."
    
    # Get token
    TOKEN=$(get_token)
    if [ -z "$TOKEN" ]; then
        print_error "Failed to read token from .git-token file"
        exit 1
    fi
    
    print_success "Token loaded successfully"
    
    # Configure development repository
    configure_repo "dev" "https://github.com/yadavshashankr/one-host-develop.git" "$TOKEN"
    
    # Configure production repository
    configure_repo "prod" "https://github.com/yadavshashankr/one-host.git" "$TOKEN"
    
    # Set origin to development by default
    git remote set-url origin "https://${TOKEN}@github.com/yadavshashankr/one-host-develop.git"
    print_success "Set origin to development repository"
    
    echo ""
    print_success "Git configuration completed!"
    echo ""
    print_status "Available remotes:"
    git remote -v
    echo ""
    print_status "Usage:"
    echo "  git push dev main    # Push to development"
    echo "  git push prod main   # Push to production"
    echo "  git push origin main # Push to current origin (dev by default)"
}

# Function to show usage
show_usage() {
    echo "Usage: $0"
    echo ""
    echo "This script configures Git remotes with your GitHub token for:"
    echo "  - Development: https://github.com/yadavshashankr/one-host-develop.git"
    echo "  - Production:  https://github.com/yadavshashankr/one-host.git"
    echo ""
    echo "Make sure .git-token file exists with your GitHub token."
}

# Check if token file exists
if [ ! -f ".git-token" ]; then
    print_error ".git-token file not found!"
    echo ""
    print_status "Please create .git-token file with your GitHub token:"
    echo "  GITHUB_TOKEN=your_token_here"
    exit 1
fi

# Run configuration
configure_git 