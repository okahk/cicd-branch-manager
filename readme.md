# CI/CD Branch Management Tool

A command-line tool to automate a Git-based branching and merging strategy for a two-week release cycle. This tool manages code promotion through `base` → `uat` → `pre` → `pro` environments using date-based branches.

## Features

-   **Automated Branching**: Creates new date-based branches from `base` every cycle.
-   **Scheduled Promotions**: Re-bases and merges branches on a configurable, scheduled interval (e.g., every two Mondays).
-   **State Management**: Tracks the current cycle's branches in a `status.json` file to ensure continuity.
-   **Safety Checks**: Includes a `--dry-run` mode, verifies branch existence, and uses safe force-pushing.
-   **Off-Cycle Updates**: Can merge `base` into the current cycle's branch on non-scheduled days to keep it up-to-date.

## Prerequisites

-   Node.js (v14 or higher)
-   Git

## Installation

1.  Clone the repository.
2.  Install the dependencies:
    ```bash
    npm install
    ```

## Configuration

The tool is configured via a `cicd-config.json` file in the root of the project. You can also specify a custom path using the `--config` option.

**`cicd-config.json`**

```json
{
  "baseBranch": "base",
  "uatBranch": "uat",
  "preBranch": "pre",
  "proBranch": "pro",
  "remoteName": "origin",
  "cycleWeeks": 2
}
```

-   `baseBranch`: The main development branch.
-   `uatBranch`: The User Acceptance Testing branch.
-   `preBranch`: The Pre-production (staging) branch.
-   `proBranch`: The Production branch.
-   `remoteName`: The name of the Git remote (e.g., `origin`).
-   `cycleWeeks`: The length of the release cycle in weeks (default is `2`).

## Usage

The tool is executed via `node cicd-branch-tool.js` with one of the following primary commands.

### Run the Full Workflow

Executes the complete promotion workflow, including creating, rebasing, and merging branches. This command makes live changes to the repository.

```bash
node cicd-branch-tool.js --run
```

### Dry Run (Preview)

Simulates the entire workflow without making any changes. Use this to see what actions the tool will perform.

```bash
node cicd-branch-tool.js --dry-run
```

### Initialize Branches

Creates the required date-based branches (`base`, `uat`, `pre`, `pro`) if they do not already exist. This is useful for setting up the repository for the first time.

```bash
node cicd-branch-tool.js --init
```

### Verify Branches

Checks if all required branches for the current cycle exist in the repository and exits with an error if any are missing.

```bash
node cicd-branch-tool.js --verify
```

### Command-Line Options

-   `--config <path>`: Path to a custom configuration file.
-   `--git <dir>`: Path to the Git repository. Defaults to the current directory.
-   `--status <file>`: Path to the status file for state management (e.g., `status.json`).
-   `--date <YYYY-MM-DD>`: Use a custom date for calculations instead of the current date.

### Example: Running on a Specific Date

```bash
node cicd-branch-tool.js --run --date 2025-08-11 --status status.json
```

## Workflow

The tool automates the following branching and promotion strategy:

1.  **On a scheduled Monday**:
    -   A new branch (e.g., `2025-08-11`) is created from `base`.
    -   `pro` is rebased onto the production source branch from two cycles ago.
    -   `pre` and `uat` are rebased onto the UAT source branch from the previous cycle.
    -   The new branch is merged back into `base`.
    -   Source branches are merged into their respective environment branches (`uat`, `pre`, `pro`) if they have diverged.

2.  **On a non-scheduled day**:
    -   If run with `--run`, the tool will merge the latest changes from `base` into the current cycle's branch (e.g., `2025-08-11`) to keep it up-to-date.

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