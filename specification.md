# CI/CD Branch Management Tool - Technical Specification

## 1. Overview

The CI/CD Branch Management Tool is a Node.js command-line application designed to automate a Git-based branching and merging strategy following a strict two-week release cycle. The tool manages code promotion through four environment stages (base → UAT → pre-production → production) with date-based branch naming.

## 2. Purpose

This tool automates the repetitive branching and merging tasks in a structured release cycle, ensuring consistency, reducing human error, and maintaining a predictable deployment schedule.

## 3. Command-Line Interface (CLI)

The tool is operated via the following commands and options:

-   `--run`: Executes the full branch promotion workflow, making live changes to the repository.
-   `--dry-run`: Simulates the workflow without making any actual changes, providing a preview of the actions that would be taken.
-   `--verify`: Checks if all required branches for the current cycle exist in the repository.
-   `--init`: Initializes the required date-based branches if they are missing, based on the current or a specified date.
-   `--config <path>`: Specifies the path to a custom JSON configuration file.
-   `--git <dir>`: Sets the path to the Git repository directory.
-   `--status <file>`: Enables state tracking by specifying a path to a status file (e.g., `status.json`).
-   `--date <date>`: Overrides the current date with a custom date (formatted as `YYYY-MM-DD`) for all calculations.

## 4. Core Functionality

### 4.1 Branching Strategy

The tool implements a time-based branching strategy with the following environment stages:

-   **base**: Main development branch where new features are integrated.
-   **uat**: User Acceptance Testing branch.
-   **pre**: Pre-production/Staging branch.
-   **pro**: Production branch.

Date-based branches (formatted as `YYYY-MM-DD`) are created from `base` every two weeks and promoted through the environments according to the cycle schedule.

### 4.2 Key Operations

1.  **Branch Creation**: Automatically creates new dated branches from `base` on scheduled Mondays.
2.  **Branch Promotion**: Promotes code through environments according to the 2-week cycle.
3.  **Branch Verification**: Checks for the existence of required branches.
4.  **Merge/Rebase Operations**: Handles rebasing and merging between environment branches.
5.  **Safety Checks**: Verifies branch existence and checks for divergence before merging.

## 5. Technical Implementation

### 5.1 Dependencies

-   Node.js (v14+)
-   `commander`: For command-line interface handling.
-   `simple-git`: For Git operations.
-   `date-fns`: For date calculations and formatting.

### 5.2 Date Calculation Logic

The tool calculates branch names based on:
-   Current date (or a custom date provided via `--date`).
-   Cycle length (default: 2 weeks, configurable in `cicd-config.json`).
-   Reference point: Mondays as cycle start days.

Key calculations:
-   `newBaseBranch`: The Monday of the current cycle.
-   `uatSourceBranch`: The Monday of the cycle `cycleWeeks` ago.
-   `proSourceBranch`: The Monday of the cycle `2 * cycleWeeks` ago.

### 5.3 Execution Schedule

The tool is designed to run automatically every other Monday (configurable via `cycleWeeks`). It includes logic to verify if the current date is a scheduled execution day.

## 6. Configuration

### 6.1 Default Configuration

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

### 6.2 Custom Configuration

Configuration can be customized via a `cicd-config.json` file in the working directory or a custom path specified with the `--config` option.

## 7. State Management

The tool supports state management to track the date-based branches associated with each environment.

-   **Activation**: Enabled by using the `--status <file>` option, which points to a JSON file (e.g., `status.json`).
-   **Functionality**: If the status file exists, the tool will use the branch names from the file. The status file is updated in real-time after each successful phase of the workflow that modifies the branch state. This ensures that if the workflow is interrupted, it can be resumed from the last successfully completed phase.

## 8. Workflow Execution (`--run`)

The main workflow consists of the following phases, executed in order:

1.  **Create New Base Branch**: A new date-based branch is created from the `base` branch. If the branch already exists, the tool will merge the latest changes from `base` into it to ensure it is up-to-date.
2.  **Update Production**: The `pro` branch is rebased onto its corresponding source branch from a previous cycle.
3.  **Update Pre-Production**: The `pre` branch is rebased onto the UAT source branch.
4.  **Update UAT**: The `uat` branch is rebased onto its source branch.
5.  **Merge New Base to `base`**: The newly created base branch is merged back into `base` with a merge commit.
6.  **Update UAT with Source**: The UAT source branch is merged into the `uat` branch if they have diverged.
7.  **Update Pre-Production with Source**: The UAT source branch is merged into the `pre` branch if they have diverged.
8.  **Update Production with Source**: The production source branch is merged into the `pro` branch if they have diverged.

### 8.1 Off-Cycle Execution

If the tool is run with `--run` or `--dry-run` on a day that is not a scheduled execution day, it performs a limited operation instead of the full workflow:

- It attempts to merge the main `base` branch into the current cycle's base branch (as defined in the status file, e.g., `2025-08-11`).
- This is useful for keeping the active feature branch up-to-date with the latest changes from `base` between scheduled promotion days.
- The script will exit with a fatal error if a merge conflict occurs during this operation.

## 9. Error Handling

The tool exits with specific error codes to facilitate CI/CD integration:

-   `1`: Invalid command or options.
-   `2`: File not found (e.g., configuration, Git directory).
-   `3`: A Git operation failed (e.g., merge conflict, failed push).
-   `4`: The script is run on a non-scheduled execution day.
-   `5`: One or more required branches are missing.
-   `6`: Configuration file is invalid or cannot be parsed.
-   `7`: The custom date provided via `--date` is invalid.

## 10. Safety Features

-   **Dry Run Mode**: The `--dry-run` option allows for a safe preview of all actions.
-   **Force Push Safety**: Uses `--force-with-lease` for safer force pushes during rebase operations.
-   **Divergence Check**: Before merging, the tool checks if branches have diverged to avoid unnecessary merges.
-   **Execution Day Verification**: The workflow will only run on scheduled Mondays.
-   **Branch Existence Checks**: The tool verifies that all required source branches exist before starting the workflow.
