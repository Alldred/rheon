# SPDX-License-Identifier: MIT
# Copyright (c) 2023-2024 Vypercore. All Rights Reserved

# Jump to RHEON_ROOT
cd $RHEON_ROOT

# Custom prompt to make it clear this is the rheon environment
PROMPT="[RHEON]:$PROMPT"

# Inherit the user history location
export HISTFILE=$USER_HISTFILE

# Incrementally append to history file
setopt INC_APPEND_HISTORY

# Ensure uv environment is installed (when pyproject.toml/uv.lock present)
if [ -f "pyproject.toml" ] || [ -f "uv.lock" ]; then
    echo "# Checking Python environment is up-to-date"
    if [ ! -d ".venv" ] || [ ! -f "uv.lock" ]; then
        uv lock
        uv sync --extra dev
    fi
    echo "# Activating virtual environment"
    export VIRTUAL_ENV_DISABLE_PROMPT=1
    source .venv/bin/activate
    echo "# Setting up pre-commit hooks"
    pre-commit install > /dev/null
fi

# Ensure web environment is installed (when viewer present)
if [ -d "$RHEON_ROOT/viewer" ] && npm -v >& /dev/null; then
    cd $RHEON_ROOT/viewer
    npm install --no-fund --no-audit
    cd $RHEON_ROOT
elif [ -d "$RHEON_ROOT/viewer" ] && ! npm -v >& /dev/null; then
    echo "NPM not installed - HTML writer will be disabled. See 'https://docs.npmjs.com/downloading-and-installing-node-js-and-npm'"
fi
