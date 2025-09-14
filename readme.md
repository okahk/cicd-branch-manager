# CI/CD Branch Management Tool

A command-line tool to automate a Git-based branching and merging strategy for a two-week release cycle. This tool manages code promotion through `base` → `uat` → `pre` → `pro` environments using date-based branches.

## Features

-   **Automated Branching**: Creates new date-based branches from `base` every cycle.
-   **Scheduled Promotions**: Re-bases and merges branches on a configurable, scheduled interval (e.g., every two Mondays).
-   **State Management**: Tracks the current cycle's branches in a `status.json` file to ensure continuity.
-   **Safety Checks**: Includes a `dry-run` mode, verifies branch existence, and uses safe force-pushing.
-   **Off-Cycle Updates**: Can merge `base` into the current cycle's branch on non-scheduled days to keep it up-to-date.

## Prerequisites

-   Node.js (v14 or higher)
-   Git

## Installation

### Global Installation (Recommended)

Install globally to use the `cicd-branch-manager` command from anywhere:

```bash
npm install -g git+https://github.com/your-username/cicd-branch-manager.git
```

After global installation, you can use the tool with:

```bash
cicd-branch-manager run
```

### Local Installation

1.  Clone the repository.
2.  Install the dependencies:
    ```bash
    npm install
    ```

## Configuration

The tool is configured via a `config.json` file in the root of the project. You can also specify a custom path using the `--config` option.

**`config.json`**

```json
{
  "baseBranch": "base",
  "uatBranch": "uat",
  "preBranch": "pre",
  "proBranch": "pro",
  "remoteName": "origin",
  "cycleDays": 14,
  "branchPrefix": "",
  "autoRemoveBranches": false,
  "branchRetentionCycles": 3,
  "dateFormat": "yyyy-MM-dd"
}
```

-   `baseBranch`: The main development branch.
-   `uatBranch`: The User Acceptance Testing branch.
-   `preBranch`: The Pre-production (staging) branch.
-   `proBranch`: The Production branch.
-   `remoteName`: The name of the Git remote (e.g., `origin`).
-   `cycleDays`: The length of the release cycle in days (default is `14`).
-   `branchPrefix`: Optional prefix for date-based branches (e.g., "feature" creates "feature/2025-08-18" instead of "2025-08-18").
-   `autoRemoveBranches`: When `true`, automatically removes old prefixed branches. Only works when `branchPrefix` is set.
-   `branchRetentionCycles`: Number of release cycles to keep when `autoRemoveBranches` is enabled (default is `3`).
-   `dateFormat`: Date format for branch names (default is `yyyy-MM-dd`).

## Usage

### Global Usage (After Global Installation)

The tool is executed via `cicd-branch-manager` with one of the following primary commands:

**Command Structure:**
```
cicd-branch-manager [options] <command>
```

**Available Commands:**
- `run` - Execute the full workflow
- `init` - Initialize branches  
- `verify` - Verify branches exist

### Local Usage

The tool is executed via `node cicd-branch-tool.js` with one of the following primary commands.

### Run the Full Workflow

Executes the complete promotion workflow, including creating, rebasing, and merging branches. This command makes live changes to the repository.

**Global installation:**
```bash
cicd-branch-manager run
```

**Local installation:**
```bash
node cicd-branch-tool.js run
```

### Dry Run (Preview)

Simulates the entire workflow without making any changes. Use this to see what actions the tool will perform.

**Global installation:**
```bash
cicd-branch-manager --dry-run run
```

**Local installation:**
```bash
node cicd-branch-tool.js --dry-run run
```

### Initialize Branches

Creates the required date-based branches (`base`, `uat`, `pre`, `pro`) if they do not already exist. This is useful for setting up the repository for the first time.

**Global installation:**
```bash
cicd-branch-manager init
```

**Local installation:**
```bash
node cicd-branch-tool.js init
```

### Verify Branches

Checks if all required branches for the current cycle exist in the repository and exits with an error if any are missing.

**Global installation:**
```bash
cicd-branch-manager verify
```

**Local installation:**
```bash
node cicd-branch-tool.js verify
```

### Command-Line Options

All options work with both global and local installations:

-   `-c, --config <path>`: Path to a custom configuration file (default: `config.json`).
-   `-s, --status <path>`: Path to the status file for state management (default: `status.json`).
-   `-d, --dry-run`: Simulate workflow without making changes.
-   `-g, --git-dir <dir>`: Path to the Git repository. Defaults to the current directory.
-   `--date <YYYY-MM-DD>`: Use a custom date for calculations instead of the current date.

### Quick Start Guide

1. **Install globally:**
   ```bash
   npm install -g git+https://github.com/your-username/cicd-branch-manager.git
   ```

2. **Navigate to your Git repository:**
   ```bash
   cd /path/to/your/git/repo
   ```

3. **Initialize branches for the first time:**
   ```bash
   cicd-branch-manager init
   ```

4. **Run the workflow:**
   ```bash
   cicd-branch-manager run
   ```

5. **Preview changes before running:**
   ```bash
   cicd-branch-manager --dry-run run
   ```

### Example: Running on a Specific Date

**Global installation:**
```bash
cicd-branch-manager --date 2025-08-11 run
```

**Local installation:**
```bash
node cicd-branch-tool.js --date 2025-08-11 run
```

## Workflow

The tool automates the following branching and promotion strategy:

1.  **On a scheduled execution day** (when enough days have passed since the last cycle):
    -   A new date-based branch (e.g., `2025-08-11`) is created from `base`.
    -   Environment branches are updated to track their designated date-based branches.
    -   `uat` is rebased onto the new base branch.
    -   `pre` is merged with the current uat source branch.
    -   `pro` is merged with the current pro source branch.
    -   The state is updated and saved to the status file.

2.  **On a non-scheduled day**:
    -   If run with `run`, the tool will merge the latest changes from `base` into the current cycle's branch (e.g., `2025-08-11`) to keep it up-to-date.

## Error Codes

The tool exits with the following codes to aid in scripting and CI/CD integration:

| Code | Description                               |
| :--- | :---------------------------------------- |
| `1`  | Invalid command or options.               |
| `2`  | File not found (config, Git directory).   |
| `3`  | A Git operation failed (e.g., merge conflict). |
| `4`  | The script is run on a non-scheduled day. |
| `5`  | A required branch is missing.             |
| `6`  | The configuration file is invalid.        |
| `7`  | The custom date format is invalid.        |