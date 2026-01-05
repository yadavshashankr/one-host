#!/bin/bash

# One-Host Deployment Script
# Usage: ./deploy.sh [dev|prod|pro]

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

# Function to show usage
show_usage() {
    echo "Usage: $0 [dev|prod|pro]"
    echo ""
    echo "Options:"
    echo "  dev   - Deploy to development environment"
    echo "  prod  - Deploy to production environment"
    echo "  pro   - Deploy to pro environment"
    echo ""
    echo "Examples:"
    echo "  $0 dev   # Deploy to development"
    echo "  $0 prod  # Deploy to production"
    echo "  $0 pro   # Deploy to pro"
    echo ""
    echo "Repository URLs:"
    echo "  Development: https://github.com/yadavshashankr/one-host-develop.git"
    echo "  Production:  https://github.com/yadavshashankr/one-host.git"
    echo "  Pro:         https://github.com/yadavshashankr/one-host-pro.git"
}

# Function to validate environment
validate_environment() {
    if [[ "$1" != "dev" && "$1" != "prod" && "$1" != "pro" ]]; then
        print_error "Invalid environment: $1"
        show_usage
        exit 1
    fi
}

# Function to check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    # Check if Node.js is installed
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed. Please install Node.js first."
        exit 1
    fi
    
    # Check if git is installed
    if ! command -v git &> /dev/null; then
        print_error "Git is not installed. Please install Git first."
        exit 1
    fi
    
    print_success "Prerequisites check passed"
}

# Function to switch environment
switch_environment() {
    local env=$1
    
    print_status "Switching to $env environment..."
    
    # Run the environment switcher
    node switch-env.js $env
    
    print_success "Environment switched successfully"
}

# Function to show deployment info
show_deployment_info() {
    local env=$1
    
    print_status "Deployment Information:"
    echo ""
    
    if [ "$env" = "prod" ]; then
        echo "  Environment: Production"
        echo "  Base URL: https://one-host.app/"
        echo "  GitHub Repo: https://github.com/yadavshashankr/one-host.git"
        echo "  CNAME: one-host.app"
    elif [ "$env" = "pro" ]; then
        echo "  Environment: Pro"
        echo "  Base URL: https://yadavshashankr.github.io/one-host-pro/"
        echo "  GitHub Repo: https://github.com/yadavshashankr/one-host-pro.git"
        echo "  CNAME: yadavshashankr.github.io"
    else
        echo "  Environment: Development"
        echo "  Base URL: https://yadavshashankr.github.io/one-host-develop/"
        echo "  GitHub Repo: https://github.com/yadavshashankr/one-host-develop.git"
        echo "  CNAME: yadavshashankr.github.io"
    fi
    
    echo ""
}

# Function to create CNAME file
create_cname_file() {
    local env=$1
    
    print_status "Creating CNAME file for $env environment..."
    
    if [ "$env" = "prod" ]; then
        echo "one-host.app" > CNAME
        print_success "Created CNAME file with: one-host.app"
    elif [ "$env" = "pro" ]; then
        echo "yadavshashankr.github.io" > CNAME
        print_success "Created CNAME file with: yadavshashankr.github.io"
    else
        echo "yadavshashankr.github.io" > CNAME
        print_success "Created CNAME file with: yadavshashankr.github.io"
    fi
}

# Function to generate cache bust version
generate_cache_bust() {
    print_status "Generating cache bust version..."
    
    if [ ! -f "generate-cache-bust.js" ]; then
        print_error "generate-cache-bust.js not found!"
        return 1
    fi
    
    # Run cache busting script and capture output
    local output=$(node generate-cache-bust.js 2>&1)
    local exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        # Extract version hash from output (look for "version: " or "hash: " pattern)
        local version_hash=$(echo "$output" | grep -oE '(version|hash): [a-f0-9]+' | grep -oE '[a-f0-9]+' | head -1)
        
        if [ -n "$version_hash" ]; then
            print_success "Cache bust version generated: $version_hash"
            echo "  Updated index.html with version query parameters"
        else
            # Try to extract from "Using git commit hash:" line
            version_hash=$(echo "$output" | grep -oE 'git commit hash: [a-f0-9]+' | grep -oE '[a-f0-9]+' | head -1)
            if [ -n "$version_hash" ]; then
                print_success "Cache bust version generated: $version_hash"
                echo "  Updated index.html with version query parameters"
            else
                print_success "Cache busting completed (version hash in output above)"
            fi
        fi
        echo ""
    else
        print_warning "Cache busting script encountered an error, but continuing..."
        return 1
    fi
}

# Function to check git remote
check_git_remote() {
    local env=$1
    
    print_status "Checking Git remote configuration..."
    
    local expected_url=""
    if [ "$env" = "prod" ]; then
        expected_url="https://github.com/yadavshashankr/one-host.git"
    elif [ "$env" = "pro" ]; then
        expected_url="https://github.com/yadavshashankr/one-host-pro.git"
    else
        expected_url="https://github.com/yadavshashankr/one-host-develop.git"
    fi
    
    local current_url=$(git remote get-url origin 2>/dev/null || echo "")
    
    if [ "$current_url" != "$expected_url" ]; then
        print_warning "Git remote URL mismatch!"
        echo "  Expected: $expected_url"
        echo "  Current:  $current_url"
        echo ""
        print_warning "Please update your Git remote:"
        echo "  git remote set-url origin $expected_url"
        echo ""
        read -p "Do you want to update the remote URL now? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            git remote set-url origin "$expected_url"
            print_success "Git remote URL updated"
        else
            print_warning "Please update the remote URL manually before deploying"
        fi
    else
        print_success "Git remote URL is correct"
    fi
}

# Main deployment function
deploy() {
    local env=$1
    
    print_status "Starting deployment for $env environment..."
    
    # Check prerequisites
    check_prerequisites
    
    # Switch environment
    switch_environment "$env"
    
    # Generate cache bust version
    generate_cache_bust
    
    # Create CNAME file
    create_cname_file "$env"
    
    # Check git remote
    check_git_remote "$env"
    
    # Show deployment info
    show_deployment_info "$env"
    
    print_success "Deployment preparation completed!"
    echo ""
    print_status "Next steps:"
    echo "  1. Commit your changes: git add . && git commit -m 'Deploy to $env'"
    echo "  2. Push to your repository: git push origin main"
    echo "  3. Wait for deployment to complete"
    echo ""
    
    if [ "$env" = "prod" ]; then
        print_warning "Production deployment will be available at: https://one-host.app/"
    elif [ "$env" = "pro" ]; then
        print_warning "Pro deployment will be available at: https://yadavshashankr.github.io/one-host-pro/"
    else
        print_warning "Development deployment will be available at: https://yadavshashankr.github.io/one-host-develop/"
    fi
}

# Main script logic
main() {
    # Check if environment argument is provided
    if [ $# -eq 0 ]; then
        print_error "No environment specified"
        show_usage
        exit 1
    fi
    
    # Validate environment
    validate_environment "$1"
    
    # Deploy
    deploy "$1"
}

# Run main function with all arguments
main "$@" 