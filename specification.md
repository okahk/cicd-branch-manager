# CI/CD Branch Management Tool - Technical Specification

## 1. Overview

The CI/CD Branch Management Tool is a Node.js command-line application designed to automate a Git-based branching and synchronization strategy following a strict release cycle (default: 14 days). The tool manages code synchronization through four environment stages using a state-tracking mechanism with date-based branch targets.

### Installation Options

The tool supports two installation methods:

1. **Global Installation** (Recommended): Install globally via npm to use the `git-cicd` command from anywhere:
   ```bash
   npm install -g git+https://github.com/your-username/cicd-branch-manager.git
   ```

2. **Local Installation**: Clone and install locally for development or testing:
   ```bash
   git clone <repository-url>
   npm install
   ```

## 2. Purpose

This tool automates the repetitive branching and synchronization tasks in a structured release cycle. It uses a state-tracking mechanism to ensure environment branches (`uat`, `pre`, `pro`) are consistently synchronized with specific date-based branch targets, reducing human error and maintaining a predictable deployment schedule.

## 3. Command-Line Interface (CLI)

The tool is operated via the `git-cicd` command (global installation) or `node cicd-branch-tool.js` (local installation) with the following options:

-   `--run`: Executes the full branch synchronization workflow, making live changes to the repository.
-   `--dry-run`: Simulates the workflow without making any actual changes, providing a preview of the actions that would be taken.
-   `verify`: Checks if all required branches for the current cycle exist in the repository.
-   `init`: Initializes the required date-based branches and creates a status file if missing, based on the current or a specified date.
-   `--config <path>`: Specifies the path to a custom JSON configuration file.
-   `--git-dir <dir>`: Sets the path to the Git repository directory.
-   `--status <file>`: **Required for state tracking.** Specifies the path to the status JSON file (e.g., `status.json`).
-   `--date <date>`: Overrides the current date with a custom date (formatted as `YYYY-MM-DD`) for all calculations.

### Usage Examples

**Global Installation:**
```bash
git-cicd run --status status.json
git-cicd dry-run --config custom-config.json --status status.json
git-cicd init --status status.json
```

**Local Installation:**
```bash
node cicd-branch-tool.js run --status status.json
node cicd-branch-tool.js dry-run --config custom-config.json --status status.json
node cicd-branch-tool.js init --status status.json
```

## 4. Core Functionality

### 4.1 State-Tracking Synchronization Strategy

The tool does not implement a linear promotion flow. Instead, it uses a state-tracking mechanism where environment branches (`uat`, `pre`, `pro`) are repeatedly synchronized (via rebase or merge) with specific, immutable date-based branch targets.

A new date-based branch (e.g., `2025-09-15`) is created from `base` at the start of a new cycle. This branch serves as the stable target for the current development cycle. The state of the system is tracked by a status object (`status.json`), which records the specific date-based branch that each environment should be synchronized with.

On a new cycle, the status is updated ("rotated"), effectively promoting the *targets* backward through the environments (`pro`'s old target becomes `pre`'s new target, etc.). The environment branches are then rebased onto their new targets.

#### Branch Naming Examples:

**Without prefix (default):**
- `2025-08-18`
- `2025-09-01`
- `2025-09-15`

**With prefix (e.g., `"branchPrefix": "feature"`):**
- `feature/2025-08-18`
- `feature/2025-09-01`
- `feature/2025-09-15`

**With prefix (e.g., `"branchPrefix": "release"`):**
- `release/2025-08-18`
- `release/2025-09-01`
- `release/2025-09-15`

#### Automatic Branch Cleanup

When `autoRemoveBranches` is set to `true` and a `branchPrefix` is configured, the tool will automatically clean up old date-based branches after completing the workflow:

- **Retention Policy**: Keeps the most recent cycles as specified by `branchRetentionCycles` (default: 3)
- **Configurable Expiration**: The number of cycles to retain can be customized via `branchRetentionCycles`
- **Cleanup Scope**: Only removes branches that match the configured prefix pattern
- **Safety**: Does not remove environment branches (`base`, `uat`, `pre`, `pro`)
- **Pattern Matching**: Only removes branches matching `{prefix}/YYYY-MM-DD` format
- **Validation**: Invalid retention values (< 1) automatically default to 3 cycles

**Example cleanup scenarios:**

**Scenario 1: Default retention (3 cycles)**
```json
{
	"branchPrefix": "feature",
	"autoRemoveBranches": true,
	"branchRetentionCycles": 3
}
```
If you have branches: `feature/2025-07-01`, `feature/2025-07-15`, `feature/2025-08-01`, `feature/2025-08-15`, `feature/2025-09-01`

The tool will:
- Keep: `feature/2025-08-15`, `feature/2025-09-01`, `feature/2025-09-15` (3 most recent)
- Remove: `feature/2025-07-01`, `feature/2025-07-15` (older than 3 cycles)

**Scenario 2: Extended retention (5 cycles)**
```json
{
	"branchPrefix": "release",
	"autoRemoveBranches": true,
	"branchRetentionCycles": 5
}
```
Keeps 5 most recent cycles instead of 3, providing longer retention for compliance or rollback requirements.

### 4.2 Key Operations

1.  **State Initialization**: Creates the initial status file and date-based branches.
2.  **Synchronization (Rebase)**: Rebases environment branches onto their target date-based branches to ensure a clean, linear history.
3.  **Status Rotation**: Updates the status to promote targets backward through environments at the start of a new cycle.
4.  **Synchronization (Merge)**: Merges changes from target branches into environment branches to prepare them for the new cycle.
5.  **Branch Verification**: Checks for the existence of all branches referenced in the status file.
6.  **Safety Checks**: Verifies branch existence and checks for divergence before merging/rebase.

## 5. Technical Implementation

### 5.1 Dependencies

-   Node.js (v14+)
-   `commander`: For command-line interface handling.
-   `simple-git`: For Git operations.
-   `date-fns`: For date calculations and formatting.

### 5.2 Date Calculation Logic

The tool calculates branch names based on:
-   Current date (or a custom date provided via `--date`).
-   Cycle length (default: 14 days, configurable via `cycleDays` in `config.json`).
-   Reference point: The tool calculates the most recent Monday as the start of a cycle.

### 5.3 Execution Schedule

The tool is designed to run automatically on a scheduled basis (e.g., via a cron job). The full workflow executes when the time since the last cycle (`status.last_cycle`) exceeds the configured `cycleDays`. It includes logic to verify if the current date is a scheduled execution day.

## 6. Configuration

### 6.1 Default Configuration

The tool looks for a `config.json` file in the current directory by default. If not found, it uses the built-in defaults:

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
	"branchRetentionCycles": 3
}
```

#### Configuration Options:

- `baseBranch`: Main development branch name
- `uatBranch`: User Acceptance Testing branch name
- `preBranch`: Pre-production/staging branch name
- `proBranch`: Production branch name
- `remoteName`: Git remote name (typically "origin")
- `cycleDays`: Release cycle length in days
- `branchPrefix`: Optional prefix for date-based branches (e.g., "feature" creates "feature/2025-08-18")
- `autoRemoveBranches`: Enable automatic cleanup of old prefixed branches (default: false)
- `branchRetentionCycles`: Number of release cycles to retain during cleanup (default: 3)

### 6.2 Custom Configuration

Configuration can be customized via a `config.json` file in the working directory or a custom path specified with the `--config` option.

## 7. State Management

The tool requires state management to track the date-based branches associated with each environment. This is critical for the tool's operation.

-   **Activation**: Required and enabled by using the `--status <file>` option, which points to a JSON file (e.g., `status.json`).
-   **Functionality**: The status file stores the state of the system. If the file exists, the tool will use the branch names from the file. The status file is updated in real-time after each successful phase of the workflow. This ensures that if the workflow is interrupted, it can be resumed from the last successfully completed phase.

### 7.1 Status File Structure

The status file (e.g., `status.json`) is a JSON object that persists the state of the branch targets between tool executions.

**Example `status.json`:**
```json
{
  "last_cycle": "2025-09-01",
  "last_update": "2025-09-15",
  "base": "2025-09-15",
  "uat": "2025-09-01",
  "pre": "2025-08-18",
  "pro": "2025-08-04"
}
```
-   `last_cycle`: The date when the last full cycle workflow was executed.
-   `last_update`: The date when the status was last modified.
-   `base`: The date-based branch representing the target for the *current* development cycle.
-   `uat`: The date-based branch that the `uat` environment should be synchronized with.
-   `pre`: The date-based branch that the `pre` environment should be synchronized with.
-   `pro`: The date-based branch that the `pro` environment should be synchronized with.

## 8. Workflow Execution (`--run`)

The main workflow, which runs when a new cycle is detected, consists of the following phases:

1.  **Synchronize Environments (Rebase Phase):** Environment branches are rebased onto the date-based branches defined in the status object, ensuring a clean, linear history for deployment.
    -   Rebase `pro` branch onto the branch named in `status.pro`
    -   Rebase `pre` branch onto the branch named in `status.pre`
    -   Rebase `uat` branch onto the branch named in `status.uat`

2.  **Update Status & Create New Cycle Target:** The status is rotated backward to promote the previous cycle's targets. A new date-based branch is created for the new cycle.
    -   Set `status.pro` = `status.pre`
    -   Set `status.pre` = `status.uat`
    -   Set `status.uat` = `status.base`
    -   Create a new date-based branch `new_base` from `base` (e.g., `2025-09-15`)
    -   Set `status.base` = `new_base`
    -   Set `status.last_cycle` = `TODAY`

3.  **Synchronize Environments (Merge Phase):** The latest changes are merged from the stable target branches into the environment branches to prepare them for the new cycle.
    -   Merge the branch named in `status.base` -> `base` branch
    -   Merge the branch named in `status.uat` -> `uat` branch (if diverged)
    -   Merge the branch named in `status.pre` -> `pre` branch (if diverged)
    -   Merge the branch named in `status.pro` -> `pro` branch (if diverged)

4.  **Save State:** The updated status object is saved to the status file.

### 8.1 Off-Cycle Execution

If the tool is run with `--run` or `--dry-run` on a day that is not a scheduled execution day (i.e., `(TODAY - status.last_cycle) < config.cycleDays`), it performs a limited operation instead of the full workflow:

- It attempts to merge the main `base` branch into the *current cycle's base branch* (i.e., the branch named in `status.base`, like `2025-09-15`).
- This is useful for keeping the active development target updated with the latest changes from `base` between scheduled cycle days.
- The script will exit with a fatal error if a merge conflict occurs during this operation.

## 9. Error Handling

The tool exits with specific error codes to facilitate CI/CD integration:

-   `1`: Invalid command or options.
-   `2`: File not found (e.g., configuration, Git directory, status file).
-   `3`: A Git operation failed (e.g., merge conflict, failed push, rebase conflict).
-   `4`: The script is run on a non-scheduled execution day (off-cycle execution performed instead).
-   `5`: One or more required branches are missing (e.g., a branch referenced in the status file does not exist).
-   `6`: Configuration file or status file is invalid or cannot be parsed.
-   `7`: The custom date provided via `--date` is invalid.
-   `8`: The `--status` option is required but was not provided.

## 10. Safety Features

-   **Dry Run Mode**: The `--dry-run` option allows for a safe preview of all actions without making changes.
-   **Status File Requirement**: Prevents accidental execution without state tracking.
-   **Force Push Safety**: Uses `--force-with-lease` for safer force pushes during rebase operations.
-   **Divergence Check**: Before merging, the tool checks if branches have diverged to avoid unnecessary merges.
-   **Branch Existence Checks**: The tool verifies that all required source branches exist before starting operations.
-   **Error Codes**: Specific exit codes help integrate the tool into CI/CD pipelines and handle failures appropriately.