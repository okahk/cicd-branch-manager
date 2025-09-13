#!/usr/bin/env node

const { program } = require('commander');
const simpleGit = require('simple-git');
const { addWeeks, startOfWeek, isMonday, format, parseISO } = require('date-fns');
const fs = require('fs').promises;
const path = require('path');
const { existsSync } = require('fs');

// Default configuration
const DEFAULT_CONFIG = {
    baseBranch: 'base',
    uatBranch: 'uat',
    preBranch: 'pre',
    proBranch: 'pro',
    remoteName: 'origin',
    cycleWeeks: 2,
    branchPrefix: '',
    autoRemoveBranches: false,
    branchRetentionCycles: 3,
    dateFormat: "yyyy-MM-dd"
};

const DEFINT_COMMAND_LINE_CONFIG = {
    config: 'config.json',
    status: 'status.json',
    dryRun: false,
    git: "./"
};

// Error codes for CI/CD pipeline
const ERROR_CODES = {
    INVALID_COMMAND: 1,
    FILE_NOT_FOUND: 2,
    GIT_OPERATION_FAILED: 3,
    NOT_EXECUTION_DAY: 4,
    MISSING_BRANCHES: 5,
    CONFIG_ERROR: 6,
    INVALID_DATE: 7
};

// Utility functions
const exitWithError = (code, message) => {
    console.error(`[FATAL] ${message}`);
    process.exit(code);
};

const logInfo = (message) => console.log(`[INFO] ${message}`);
const logSuccess = (message) => console.log(`[SUCCESS] ${message}`);
const logWarn = (message) => console.warn(`[WARN] ${message}`);
const logError = (message) => console.error(`[ERROR] ${message}`);
const logAction = (message) => console.log(`\n[ACTION] ${message}`);

// Load configuration from file or exit on critical error
async function loadConfig(configPath) {
    try {
        const resolvedPath = path.resolve(configPath);
        if (!existsSync(resolvedPath)) {
            if (configPath) exitWithError(ERROR_CODES.FILE_NOT_FOUND, `Config file not found: ${resolvedPath}`);
            logWarn('Using default configuration (config.json not found)');
            return DEFAULT_CONFIG;
        }

        const configData = await fs.readFile(resolvedPath, 'utf8');
        return { ...DEFAULT_CONFIG, ...JSON.parse(configData) };
    } catch (error) {
        exitWithError(ERROR_CODES.CONFIG_ERROR, `Configuration error: ${error.message}`);
    }
}

// Load status file or exit on critical error
async function loadStatusFile(statusPath) {
    if (!statusPath) return {};
    try {
        if (existsSync(statusPath)) {
            const data = await fs.readFile(statusPath, 'utf8');
            return JSON.parse(data);
        }
        logInfo(`Status file not found at ${statusPath}, creating new state`);
        return {};
    } catch (error) {
        exitWithError(ERROR_CODES.FILE_NOT_FOUND, `Failed to read status file: ${error.message}`);
    }
}

// Save state to status file or exit on failure
async function saveStatusFile(statusPath, state) {
    if (!statusPath) return;
    try {
        await fs.writeFile(statusPath, JSON.stringify(state, null, 2), 'utf8');
        logInfo(`Updated state file: ${statusPath}`);
    } catch (error) {
        exitWithError(ERROR_CODES.FILE_NOT_FOUND, `Failed to write status file: ${error.message}`);
    }
}

// Calculate branch dates based on specified date
function calculateBranchDates(currentDate = new Date(), cycleWeeks = 2, branchPrefix = '', dateFormat = "yyyy-MM-dd") {
    let cycleMonday = startOfWeek(currentDate, { weekStartsOn: 1 });
    
    if (!isMonday(currentDate)) cycleMonday = addWeeks(cycleMonday, -1);
    
    const formatBranchName = (date) => {
        const dateStr = format(date, dateFormat);
        return branchPrefix ? `${branchPrefix}/${dateStr}` : dateStr;
    };
    
    return {
        newBaseBranch: formatBranchName(cycleMonday),
        uatSourceBranch: formatBranchName(addWeeks(cycleMonday, -cycleWeeks)),
        proSourceBranch: formatBranchName(addWeeks(cycleMonday, -cycleWeeks * 2)),
        cycleMonday: format(cycleMonday, 'yyyy-MM-dd')
    };
}

// Check if specified date is a valid execution day
function isExecutionDay(currentDate = new Date(), cycleWeeks = 2) {
    if (!isMonday(currentDate)) return false;
    
    const year = currentDate.getFullYear();
    const firstMonday = startOfWeek(new Date(year, 0, 1), { weekStartsOn: 1 });
    
    const weeksSinceFirst = Math.floor(
        (currentDate - firstMonday) / (1000 * 60 * 60 * 24 * 7)
    );
    
    return weeksSinceFirst % cycleWeeks === 0;
}

// Git operations handler with strict error checking
class GitOperations {
    constructor(config, gitDir, dryRun = false) {
        this.gitDir = gitDir || process.cwd();
        this.git = simpleGit({
            baseDir: this.gitDir,
            binary: 'git',
            maxConcurrentProcesses: 1
        });
        this.config = config;
        this.dryRun = dryRun;
        this.currentBranch = null;
    }

    async execute(command, actionDescription, critical = true) {
        logAction(actionDescription);
        console.log(`[GIT DIR] ${this.gitDir}`);
        
        if (this.dryRun) {
            console.log(`[DRY RUN] Would execute this action`);
            return { success: true, dryRun: true };
        }
        
        try {
            const result = await command();
            logSuccess('Operation completed');
            return { success: true, result };
        } catch (error) {
            logError(`Operation failed: ${error.message}`);
            if (critical) exitWithError(ERROR_CODES.GIT_OPERATION_FAILED, 'Critical operation failed - exiting');
            return { success: false, error };
        }
    }

    async getCurrentBranch() {
        if (this.currentBranch) return this.currentBranch;
        
        try {
            const status = await this.git.status();
            this.currentBranch = status.current;
            return this.currentBranch;
        } catch (error) {
            logError(`Failed to get current branch: ${error.message}`);
            return null;
        }
    }

    async branchExists(branch) {
        try {
            const localBranches = await this.git.branchLocal();
            if (localBranches.all.includes(branch)) return true;

            const remoteBranches = await this.git.raw([
                'ls-remote', '--heads', this.config.remoteName, branch
            ]);
            return remoteBranches.trim() !== '';
        } catch (error) {
            exitWithError(ERROR_CODES.GIT_OPERATION_FAILED, `Failed to check branch existence: ${error.message}`);
        }
    }

    async pull(branch, critical = true) {
        return this.execute(
            async () => {
                await this.git.checkout(branch);
                await this.git.pull(this.config.remoteName, branch);
            },
            `Pulling from ${this.config.remoteName}/${branch}`,
            critical
        );
    }

    async createBranch(fromBranch, newBranch, critical = true) {
        if (await this.branchExists(newBranch)) {
            logWarn(`Branch ${newBranch} already exists. Skipping creation.`);
            return { success: true, existed: true };
        }
        return this.execute(
            async () => {
                await this.git.checkout(fromBranch);
                await this.git.pull(this.config.remoteName, fromBranch);
                await this.git.checkoutBranch(newBranch, fromBranch);
            },
            `Creating branch ${newBranch} from ${fromBranch}`,
            critical
        );
    }

    async rebase(branch, ontoBranch, critical = true) {
        return this.execute(
            async () => {
                await this.git.checkout(branch);
                await this.git.pull(this.config.remoteName, branch);
                await this.git.rebase(ontoBranch);
            },
            `Rebasing ${branch} onto ${ontoBranch}`,
            critical
        );
    }

    async merge(branch, fromBranch, noFastForward = false, critical = true) {
        const options = noFastForward ? ['--no-ff'] : [];
        return this.execute(
            async () => {
                await this.git.checkout(branch);
                await this.git.pull(this.config.remoteName, branch);
                await this.git.merge([fromBranch, ...options]);
            },
            `Merging ${fromBranch} into ${branch} ${noFastForward ? '(with merge commit)' : ''}`,
            critical
        );
    }

    async push(branch, force = false, critical = true) {
        const options = force ? ['--force-with-lease'] : [];
        return this.execute(
            () => this.git.push(this.config.remoteName, branch, options),
            `Pushing ${branch} to ${this.config.remoteName} ${force ? '(force)' : ''}`,
            critical
        );
    }

    async branchesDiverged(branch1, branch2) {
        if (this.dryRun) return true;
        
        try {
            await this.git.raw(['merge-base', '--is-ancestor', branch1, branch2]);
            return false;
        } catch (error) {
            if (error.code === 1) return true;
            exitWithError(ERROR_CODES.GIT_OPERATION_FAILED, `Failed to check branch divergence: ${error.message}`);
        }
    }

    async deleteBranch(branch, critical = false) {
        return this.execute(
            () => this.git.deleteLocalBranch(branch)
                .then(() => this.git.push(this.config.remoteName, `:${branch}`)),
            `Deleting branch ${branch} (local and remote)`,
            critical
        );
    }

    async removeOldBranches(branchPrefix, retentionCycles = 3) {
        if (!branchPrefix) {
            logInfo('No branch prefix configured, skipping branch cleanup');
            return;
        }

        if (retentionCycles < 1) {
            logWarn(`Invalid retention cycles (${retentionCycles}), using default of 3`);
            retentionCycles = 3;
        }

        try {
            const localBranches = await this.git.branchLocal();
            const prefixedBranches = localBranches.all.filter(branch => 
                branch.startsWith(`${branchPrefix}/`) && 
                /\d{4}-\d{2}-\d{2}$/.test(branch.split('/')[1])
            );

            if (prefixedBranches.length <= retentionCycles) {
                logInfo(`Found ${prefixedBranches.length} prefixed branches, keeping all (minimum ${retentionCycles})`);
                return;
            }

            const sortedBranches = prefixedBranches.sort((a, b) => {
                const dateA = new Date(a.split('/')[1]);
                const dateB = new Date(b.split('/')[1]);
                return dateB - dateA;
            });

            const branchesToRemove = sortedBranches.slice(retentionCycles);
            
            if (branchesToRemove.length > 0) {
                console.log(`\n=== Cleaning up old branches ===`);
                console.log(`Retention policy: Keep ${retentionCycles} most recent cycles`);
                console.log(`Keeping: ${sortedBranches.slice(0, retentionCycles).join(', ')}`);
                console.log(`Removing ${branchesToRemove.length} old branches: ${branchesToRemove.join(', ')}`);
                
                for (const branch of branchesToRemove) {
                    await this.deleteBranch(branch, false);
                }
                logSuccess(`Cleaned up ${branchesToRemove.length} old branches`);
            } else {
                logInfo('No old branches to remove');
            }
        } catch (error) {
            logWarn(`Failed to clean up old branches: ${error.message}`);
        }
    }
}

// Initialize required date-based branches with strict error handling
async function initializeBranches(config, gitDir, dryRun, statusPath, customDate = null) {
    const git = new GitOperations(config, gitDir, dryRun);
    let state = await loadStatusFile(statusPath);
    const currentDate = customDate || new Date();
    
    const { newBaseBranch, uatSourceBranch, proSourceBranch } = calculateBranchDates(currentDate, config.cycleWeeks, config.branchPrefix, config.dateFormat);
    const branchesToCreate = {
        base: state.base || newBaseBranch,
        uat: state.uat || uatSourceBranch,
        pre: state.pre || uatSourceBranch,
        pro: state.pro || proSourceBranch
    };

    console.log(`=== Initializing Required Branches ===`);
    console.log(`Using date: ${format(currentDate, 'yyyy-MM-dd')}`);
    console.log(`Git directory: ${gitDir || process.cwd()}`);
    console.log(`Target branches:`, branchesToCreate);

    const sourceBranches = {
        base: config.baseBranch,
        uat: config.uatBranch,
        pre: config.preBranch,
        pro: config.proBranch
    };

    for (const [env, targetBranch] of Object.entries(branchesToCreate)) {
        const sourceBranch = sourceBranches[env];
        console.log(`\nProcessing ${env} branch: ${targetBranch}`);

        if (!await git.branchExists(sourceBranch)) {
            exitWithError(ERROR_CODES.MISSING_BRANCHES, `Source branch ${sourceBranch} does not exist`);
        }

        if (await git.branchExists(targetBranch)) {
            console.log(`✅  Branch ${targetBranch} already exists`);
            continue;
        }

        console.log(`⚠️  Branch ${targetBranch} missing - creating from ${sourceBranch}`);
        const createResult = await git.createBranch(sourceBranch, targetBranch);
        
        if (createResult.success && !dryRun) {
            await git.push(targetBranch);
            console.log(`✅  Successfully created and pushed ${targetBranch}`);
        } else if (dryRun) {
            console.log(`[DRY RUN] Would create ${targetBranch} from ${sourceBranch}`);
        } else {
            exitWithError(ERROR_CODES.GIT_OPERATION_FAILED, `Failed to create ${targetBranch}`);
        }
    }

    if (statusPath) await saveStatusFile(statusPath, branchesToCreate);

    console.log('\n=== Initialization Complete ===');
    process.exit(0);
}

// Verify all required branches exist or exit
async function verifyBranches(config, gitDir, customDate = null) {
    const git = new GitOperations(config, gitDir, true);
    const currentDate = customDate || new Date();
    
    console.log(`=== CI/CD Branch Verification ===`);
    console.log(`Using date: ${format(currentDate, 'yyyy-MM-dd')}`);
    console.log(`Repository: ${gitDir || process.cwd()}`);
    
    const { newBaseBranch, uatSourceBranch, proSourceBranch } = calculateBranchDates(currentDate, config.cycleWeeks, config.branchPrefix, config.dateFormat);
    const requiredBranches = [
        config.baseBranch, config.uatBranch, config.preBranch, config.proBranch,
        uatSourceBranch, proSourceBranch
    ];
    
    console.log('\nChecking required branches:');
    let missing = false;
    
    for (const branch of requiredBranches) {
        const exists = await git.branchExists(branch);
        if (exists) {
            console.log(`✅  ${branch}`);
        } else {
            console.error(`❌  ${branch} (missing)`);
            missing = true;
        }
    }
    
    console.log('\n=== Verification Result ===');
    if (missing) {
        console.error('❌  Missing required branches - fix before running workflow');
        process.exit(ERROR_CODES.MISSING_BRANCHES);
    } else {
        console.log('✅  All required branches exist');
        process.exit(0);
    }
}

// Main workflow execution with strict error handling
async function runWorkflow(config, gitDir, dryRun, statusPath, customDate = null) {
    const git = new GitOperations(config, gitDir, dryRun);
    const currentDate = customDate || new Date();
    let state = await loadStatusFile(statusPath) || {};
    
    console.log(`=== CI/CD Branch Management Tool ===`);
    console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
    console.log(`Using date: ${format(currentDate, 'yyyy-MM-dd')}`);
    console.log(`Repository: ${gitDir || process.cwd()}`);
    console.log(`Current state:`, state);
    
    if (!isExecutionDay(currentDate, config.cycleWeeks)) {
        logWarn(`${format(currentDate, 'yyyy-MM-dd')} is not a scheduled execution day.`);
        if (state.base && state.base !== config.baseBranch) {
            console.log(`[INFO] Attempting to merge '${config.baseBranch}' into the current cycle branch '${state.base}'.`);
            const mergeResult = await git.merge(state.base, config.baseBranch, false, true);
            if (mergeResult.success) {
                await git.push(state.base);
                logSuccess(`Merged '${config.baseBranch}' into '${state.base}' and pushed.`);
            }
        } else {
            logInfo('No active cycle branch found in status file. Nothing to merge.');
        }
        logInfo('Exiting gracefully.');
        process.exit(0);
    }
    
    const { newBaseBranch, uatSourceBranch, proSourceBranch, cycleMonday } = calculateBranchDates(currentDate, config.cycleWeeks, config.branchPrefix, config.dateFormat);
    console.log(`\n=== Cycle Information ===`);
    console.log(`Cycle start date: ${cycleMonday}`);
    console.log(`New base branch: ${newBaseBranch}`);
    console.log(`UAT source branch: ${uatSourceBranch}`);
    console.log(`PRO source branch: ${proSourceBranch}`);
    
    console.log('\n=== Verifying Required Branches ===');
    const requiredBranches = [
        config.baseBranch, config.uatBranch, config.preBranch, config.proBranch,
        uatSourceBranch, proSourceBranch
    ];
    
    for (const branch of requiredBranches) {
        if (!await git.branchExists(branch)) {
            exitWithError(ERROR_CODES.MISSING_BRANCHES, `Required branch ${branch} does not exist`);
        }
    }
    console.log('✅  All required branches exist');
    
    console.log('\n=== Creating New Base Branch ===');
    if (await git.branchExists(newBaseBranch)) {
        logWarn(`Base branch ${newBaseBranch} already exists. Skipping creation.`);
    } else {
        const createResult = await git.createBranch(config.baseBranch, newBaseBranch);
        if (!createResult.success) exitWithError(ERROR_CODES.GIT_OPERATION_FAILED, 'Failed to create new base branch');
        await git.push(newBaseBranch);
    }
    
    console.log('\n=== Updating UAT Branch ===');
    const uatRebaseResult = await git.rebase(uatSourceBranch, newBaseBranch);
    if (!uatRebaseResult.success) exitWithError(ERROR_CODES.GIT_OPERATION_FAILED, 'Failed to rebase UAT branch');
    await git.push(uatSourceBranch, true);
    
    console.log('\n=== Updating PRE Branch ===');
    const preMergeResult = await git.merge(config.preBranch, uatSourceBranch, true);
    if (!preMergeResult.success) exitWithError(ERROR_CODES.GIT_OPERATION_FAILED, 'Failed to merge into PRE branch');
    await git.push(config.preBranch);
    
    console.log('\n=== Updating PRO Branch ===');
    const proMergeResult = await git.merge(config.proBranch, proSourceBranch, true);
    if (!proMergeResult.success) exitWithError(ERROR_CODES.GIT_OPERATION_FAILED, 'Failed to merge into PRO branch');
    await git.push(config.proBranch);
    
    console.log('\n=== Updating State ===');
    const newState = {
        base: newBaseBranch,
        uat: uatSourceBranch,
        pre: uatSourceBranch,
        pro: proSourceBranch
    };
    await saveStatusFile(statusPath, newState);
    console.log('✅  State updated successfully');
    
    if (config.autoRemoveBranches) {
        console.log('\n=== Cleaning Up Old Branches ===');
        await git.removeOldBranches(config.branchPrefix, config.branchRetentionCycles);
    }
    
    console.log('\n=== Workflow Complete ===');
    logSuccess('All operations completed successfully!');
    process.exit(0);
}

// Main function with proper error handling
async function main() {
	program
        .name('cicd-branch-manager')
        .description('CI/CD Branch Management Tool for Git workflows')
        .version('1.0.0')
        .option('-c, --config <path>', 'Path to configuration file', DEFINT_COMMAND_LINE_CONFIG.config)
        .option('-s, --status <path>', 'Path to status file', DEFINT_COMMAND_LINE_CONFIG.status)
        .option('-d, --dry-run', 'Perform a dry run without making changes', DEFINT_COMMAND_LINE_CONFIG.dryRun)
		.option('-v, --verify', 'Check required branches exist')
	    .option('-g, --git-dir <path>', 'Path to git repository', DEFINT_COMMAND_LINE_CONFIG.git)
        .option('--date <date>', 'Use specific date (YYYY-MM-DD format)')
        .argument('<command>', 'Command to execute: init, verify, run');

    program.parse(process.argv);
    const options = program.opts();
    const [command] = program.args;

    if (!command) {
        program.help();
        process.exit(ERROR_CODES.INVALID_COMMAND);
    }

    try {
        const config = await loadConfig(options.config);
        const customDate = options.date ? parseISO(options.date) : null;
        
        if (customDate && isNaN(customDate.getTime())) {
            exitWithError(ERROR_CODES.INVALID_DATE, `Invalid date format: ${options.date}. Use YYYY-MM-DD.`);
        }

        switch (command) {
            case 'init':
                await initializeBranches(config, options.gitDir, options.dryRun, options.status, customDate);
                break;
            case 'verify':
                await verifyBranches(config, options.gitDir, customDate);
                break;
            case 'run':
                await runWorkflow(config, options.gitDir, options.dryRun, options.status, customDate);
                break;
            default:
                exitWithError(ERROR_CODES.INVALID_COMMAND, `Unknown command: ${command}`);
        }
    } catch (error) {
        exitWithError(ERROR_CODES.GIT_OPERATION_FAILED, `Unexpected error: ${error.message}`);
    }
}

// Execute main function with error handling
main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(ERROR_CODES.GIT_OPERATION_FAILED);
});