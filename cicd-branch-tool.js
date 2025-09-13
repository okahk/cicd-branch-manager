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
	cycleWeeks: 2, // Default 2-week cycle
	branchPrefix: '', // Default no prefix
	autoRemoveBranches: false, // Default no automatic branch removal
	branchRetentionCycles: 3 // Default keep 3 cycles
};

// Error codes for CI/CD pipeline
const ERROR_CODES = {
	INVALID_COMMAND: 1,
	FILE_NOT_FOUND: 2,
	GIT_OPERATION_FAILED: 3,
	NOT_EXECUTION_DAY: 4,
	MISSING_BRANCHES: 5,
	CONFIG_ERROR: 6,
	INVALID_DATE: 7 // New error code for invalid dates
};

// Load configuration from file or exit on critical error
async function loadConfig(configPath) {
	try {
		const resolvedPath = configPath ? path.resolve(configPath) : 
			path.resolve(process.cwd(), 'config.json');
		
		if (!existsSync(resolvedPath)) {
			if (configPath) {
				console.error(`[FATAL] Config file not found: ${resolvedPath}`);
				process.exit(ERROR_CODES.FILE_NOT_FOUND);
			}
			console.warn('Using default configuration (config.json not found)');
			return DEFAULT_CONFIG;
		}

		const configData = await fs.readFile(resolvedPath, 'utf8');
		return { ...DEFAULT_CONFIG, ...JSON.parse(configData) };
	} catch (error) {
		console.error(`[FATAL] Configuration error: ${error.message}`);
		process.exit(ERROR_CODES.CONFIG_ERROR);
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
		console.log(`[INFO] Status file not found at ${statusPath}, creating new state`);
		return {};
	} catch (error) {
		console.error(`[FATAL] Failed to read status file: ${error.message}`);
		process.exit(ERROR_CODES.FILE_NOT_FOUND);
	}
}

// Save state to status file or exit on failure
async function saveStatusFile(statusPath, state) {
	if (!statusPath) return;
	try {
		await fs.writeFile(statusPath, JSON.stringify(state, null, 2), 'utf8');
		console.log(`[STATUS] Updated state file: ${statusPath}`);
	} catch (error) {
		console.error(`[FATAL] Failed to write status file: ${error.message}`);
		process.exit(ERROR_CODES.FILE_NOT_FOUND);
	}
}

// Calculate branch dates based on specified date
function calculateBranchDates(currentDate = new Date(), cycleWeeks = 2, branchPrefix = '') {
	let cycleMonday = startOfWeek(currentDate, { weekStartsOn: 1 }); // 1 = Monday
	
	if (!isMonday(currentDate)) {
		cycleMonday = addWeeks(cycleMonday, -1);
	}
	
	const formatBranchName = (date) => {
		const dateStr = format(date, 'yyyy-MM-dd');
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
	}

	async execute(command, actionDescription, critical = true) {
		console.log(`\n[ACTION] ${actionDescription}`);
		console.log(`[GIT DIR] ${this.gitDir}`);
		
		if (this.dryRun) {
			console.log(`[DRY RUN] Would execute this action`);
			return { success: true, dryRun: true };
		}
		
		try {
			const result = await command();
			console.log('[SUCCESS] Operation completed');
			return { success: true, result };
		} catch (error) {
			console.error(`[ERROR] Operation failed: ${error.message}`);
			if (critical) {
				console.error(`[FATAL] Critical operation failed - exiting`);
				process.exit(ERROR_CODES.GIT_OPERATION_FAILED);
			}
			return { success: false, error };
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
			console.error(`[FATAL] Failed to check branch existence: ${error.message}`);
			process.exit(ERROR_CODES.GIT_OPERATION_FAILED);
		}
	}

	async pull(branch, critical = true) {
		return this.execute(
			() => this.git.checkout(branch).then(() => this.git.pull(this.config.remoteName, branch)),
			`Pulling latest from ${this.config.remoteName}/${branch}`,
			critical
		);
	}

	async createBranch(fromBranch, newBranch, critical = true) {
		if (await this.branchExists(newBranch)) {
			console.warn(`[WARN] Branch ${newBranch} already exists. Skipping creation.`);
			return { success: true, existed: true };
		}
		return this.execute(
			() => this.git.checkout(fromBranch)
				.then(() => this.git.pull(this.config.remoteName, fromBranch))
				.then(() => this.git.checkoutBranch(newBranch, fromBranch)),
			`Creating branch ${newBranch} from ${fromBranch}`,
			critical
		);
	}

	async rebase(branch, ontoBranch, critical = true) {
		return this.execute(
			() => this.git.checkout(branch)
				.then(() => this.git.pull(this.config.remoteName, branch))
				.then(() => this.git.rebase(ontoBranch)),
			`Rebasing ${branch} onto ${ontoBranch}`,
			critical
		);
	}

	async merge(branch, fromBranch, noFastForward = false, critical = true) {
		const options = noFastForward ? ['--no-ff'] : [];
		const mergeOptions = [fromBranch, ...options];
		return this.execute(
			() => this.git.checkout(branch)
				.then(() => this.git.pull(this.config.remoteName, branch))
				.then(() => this.git.merge(mergeOptions)),
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
			console.error(`[FATAL] Failed to check branch divergence: ${error.message}`);
			process.exit(ERROR_CODES.GIT_OPERATION_FAILED);
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
			console.log('[INFO] No branch prefix configured, skipping branch cleanup');
			return;
		}

		// Validate retention cycles
		if (retentionCycles < 1) {
			console.warn(`[WARN] Invalid retention cycles (${retentionCycles}), using default of 3`);
			retentionCycles = 3;
		}

		try {
			const localBranches = await this.git.branchLocal();
			const prefixedBranches = localBranches.all.filter(branch => 
				branch.startsWith(`${branchPrefix}/`) && 
				/\d{4}-\d{2}-\d{2}$/.test(branch.split('/')[1])
			);

			if (prefixedBranches.length <= retentionCycles) {
				console.log(`[INFO] Found ${prefixedBranches.length} prefixed branches, keeping all (minimum ${retentionCycles})`);
				return;
			}

			// Sort branches by date (newest first)
			const sortedBranches = prefixedBranches.sort((a, b) => {
				const dateA = new Date(a.split('/')[1]);
				const dateB = new Date(b.split('/')[1]);
				return dateB - dateA;
			});

			// Keep the most recent branches, remove the rest
			const branchesToRemove = sortedBranches.slice(retentionCycles);
			
			if (branchesToRemove.length > 0) {
				console.log(`\n=== Cleaning up old branches ===`);
				console.log(`Retention policy: Keep ${retentionCycles} most recent cycles`);
				console.log(`Keeping: ${sortedBranches.slice(0, retentionCycles).join(', ')}`);
				console.log(`Removing ${branchesToRemove.length} old branches: ${branchesToRemove.join(', ')}`);
				
				for (const branch of branchesToRemove) {
					await this.deleteBranch(branch, false);
				}
				console.log(`[SUCCESS] Cleaned up ${branchesToRemove.length} old branches`);
			} else {
				console.log('[INFO] No old branches to remove');
			}
		} catch (error) {
			console.error(`[WARN] Failed to clean up old branches: ${error.message}`);
		}
	}
}

// Initialize required date-based branches with strict error handling
async function initializeBranches(config, gitDir, dryRun, statusPath, customDate = null) {
	const git = new GitOperations(config, gitDir, dryRun);
	let state = await loadStatusFile(statusPath);
	const currentDate = customDate || new Date();
	
	// Use state from file or calculate based on date
	const { newBaseBranch, uatSourceBranch, proSourceBranch } = calculateBranchDates(currentDate, config.cycleWeeks, config.branchPrefix);
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

	// Mapping of environment to source branch
	const sourceBranches = {
		base: config.baseBranch,
		uat: config.uatBranch,
		pre: config.preBranch,
		pro: config.proBranch
	};

	// Check and create each required branch
	for (const [env, targetBranch] of Object.entries(branchesToCreate)) {
		const sourceBranch = sourceBranches[env];
		console.log(`\nProcessing ${env} branch: ${targetBranch}`);

		// Verify source branch exists before creating new branch
		if (!await git.branchExists(sourceBranch)) {
			console.error(`[FATAL] Source branch ${sourceBranch} does not exist`);
			process.exit(ERROR_CODES.MISSING_BRANCHES);
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
			console.error(`[FATAL] Failed to create ${targetBranch}`);
			process.exit(ERROR_CODES.GIT_OPERATION_FAILED);
		}
	}

	// Update state file with initialized branches
	if (statusPath) {
		await saveStatusFile(statusPath, branchesToCreate);
	}

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
	
	const { newBaseBranch, uatSourceBranch, proSourceBranch } = calculateBranchDates(currentDate, config.cycleWeeks, config.branchPrefix);
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
	
	// Verify execution day
	if (!isExecutionDay(currentDate, config.cycleWeeks)) {
		console.warn(`[WARN] ${format(currentDate, 'yyyy-MM-dd')} is not a scheduled execution day.`);
		if (state.base && state.base !== config.baseBranch) {
			console.log(`[INFO] Attempting to merge '${config.baseBranch}' into the current cycle branch '${state.base}'.`);
			const mergeResult = await git.merge(state.base, config.baseBranch, false, true); // Exit on conflict
			if (mergeResult.success) {
				await git.push(state.base);
				console.log(`[SUCCESS] Merged '${config.baseBranch}' into '${state.base}' and pushed.`);
			}
		} else {
			console.log('[INFO] No active cycle branch found in status file. Nothing to merge.');
		}
		console.log('[INFO] Exiting gracefully.');
		process.exit(0);
	}
	
	// Calculate branch names based on custom date
	const { newBaseBranch, uatSourceBranch, proSourceBranch } = calculateBranchDates(currentDate, config.cycleWeeks, config.branchPrefix);
	console.log('\nCycle branches:');
	console.log(`- New base: ${newBaseBranch}`);
	console.log(`- UAT source: ${uatSourceBranch}`);
	console.log(`- Production source: ${proSourceBranch}`);
	
	// Verify all required branches exist before proceeding
	console.log('\n=== Verifying required branches ===');
	const requiredBranches = [
		config.baseBranch, config.uatBranch, config.preBranch, config.proBranch,
		uatSourceBranch, proSourceBranch
	];
	
	for (const branch of requiredBranches) {
		if (!await git.branchExists(branch)) {
			console.error(`[FATAL] Required branch ${branch} is missing`);
			process.exit(ERROR_CODES.MISSING_BRANCHES);
		}
	}
	
	// Initialize new state object
	const newState = { ...state };
	
	// Phase 1: Create new base branch
	console.log('\n=== Phase 1: Create new base branch ===');
	await git.pull(config.baseBranch);
	const createBase = await git.createBranch(config.baseBranch, newBaseBranch);
	if (createBase.success) {
		if (createBase.existed) {
			console.log(`[INFO] Branch ${newBaseBranch} already exists, merging from ${config.baseBranch} to ensure it's up to date.`);
			const mergeResult = await git.merge(newBaseBranch, config.baseBranch);
			if (mergeResult.success) {
				await git.push(newBaseBranch);
			}
		} else {
			await git.push(newBaseBranch);
		}
		newState.base = newBaseBranch;
		if (statusPath) await saveStatusFile(statusPath, newState);
	} else {
		console.error(`[FATAL] Failed to create new base branch ${newBaseBranch}`);
		process.exit(ERROR_CODES.GIT_OPERATION_FAILED);
	}
	
	// Phase 2: Update production branch
	console.log('\n=== Phase 2: Update production ===');
	const rebasePro = await git.rebase(config.proBranch, proSourceBranch);
	if (rebasePro.success) {
		await git.push(config.proBranch, true);
		newState.pro = proSourceBranch;
		if (statusPath) await saveStatusFile(statusPath, newState);
	} else {
		console.error(`[FATAL] Failed to rebase production branch`);
		process.exit(ERROR_CODES.GIT_OPERATION_FAILED);
	}
	
	// Phase 3: Update pre-production
	console.log('\n=== Phase 3: Update pre-production ===');
	const rebasePre = await git.rebase(config.preBranch, uatSourceBranch);
	if (rebasePre.success) {
		await git.push(config.preBranch, true);
		newState.pre = uatSourceBranch;
		if (statusPath) await saveStatusFile(statusPath, newState);
	} else {
		console.error(`[FATAL] Failed to rebase pre-production branch`);
		process.exit(ERROR_CODES.GIT_OPERATION_FAILED);
	}
	
	// Phase 4: Update UAT
	console.log('\n=== Phase 4: Update UAT ===');
	const rebaseUat = await git.rebase(config.uatBranch, uatSourceBranch);
	if (rebaseUat.success) {
		await git.push(config.uatBranch, true);
		newState.uat = uatSourceBranch;
		if (statusPath) await saveStatusFile(statusPath, newState);
	} else {
		console.error(`[FATAL] Failed to rebase UAT branch`);
		process.exit(ERROR_CODES.GIT_OPERATION_FAILED);
	}
	
	// Phase 5: Merge new base into base branch
	console.log('\n=== Phase 5: Merge new base to base ===');
	const mergeBase = await git.merge(config.baseBranch, newBaseBranch, true);
	if (mergeBase.success) {
		await git.push(config.baseBranch);
	} else {
		console.error(`[FATAL] Failed to merge new base into base branch`);
		process.exit(ERROR_CODES.GIT_OPERATION_FAILED);
	}
	
	// Phase 6: Merge to UAT if needed
	console.log('\n=== Phase 6: Update UAT with source ===');
	if (await git.branchesDiverged(config.uatBranch, uatSourceBranch)) {
		const mergeUat = await git.merge(config.uatBranch, uatSourceBranch);
		if (mergeUat.success) {
			await git.push(config.uatBranch);
		} else {
			console.error(`[FATAL] Failed to merge into UAT branch`);
			process.exit(ERROR_CODES.GIT_OPERATION_FAILED);
		}
	} else {
		console.log('UAT is up to date - no merge needed');
	}
	
	// Phase 7: Merge to pre-production if needed
	console.log('\n=== Phase 7: Update pre-production with source ===');
	if (await git.branchesDiverged(config.preBranch, uatSourceBranch)) {
		const mergePre = await git.merge(config.preBranch, uatSourceBranch);
		if (mergePre.success) {
			await git.push(config.preBranch);
		} else {
			console.error(`[FATAL] Failed to merge into pre-production branch`);
			process.exit(ERROR_CODES.GIT_OPERATION_FAILED);
		}
	} else {
		console.log('Pre-production is up to date - no merge needed');
	}
	
	// Phase 8: Merge to production if needed
	console.log('\n=== Phase 8: Update production with source ===');
	if (await git.branchesDiverged(config.proBranch, proSourceBranch)) {
		const mergePro = await git.merge(config.proBranch, proSourceBranch);
		if (mergePro.success) {
			await git.push(config.proBranch);
		} else {
			console.error(`[FATAL] Failed to merge into production branch`);
			process.exit(ERROR_CODES.GIT_OPERATION_FAILED);
		}
	} else {
		console.log('Production is up to date - no merge needed');
	}
	
	console.log('\n=== Workflow Complete ===');
	if (dryRun) {
		console.log('This was a dry run - no changes were made');
	} else {
		console.log('All operations completed successfully');
		
		// Cleanup old branches if auto removal is enabled
		if (config.autoRemoveBranches && config.branchPrefix) {
			await git.removeOldBranches(config.branchPrefix, config.branchRetentionCycles || 3);
		}
	}
	process.exit(0);
}

// Configure CLI with --date option
program
	.name('git-cicd')
	.description('Automates CI/CD branch promotion with 2-week cycles')
	.option('--run', 'Execute workflow (makes changes)')
	.option('--dry-run', 'Preview actions without changes')
	.option('--verify', 'Check required branches exist')
	.option('--init', 'Initialize required date-based branches if missing')
	.option('--config <path>', 'Custom config file path')
	.option('--git <dir>', 'Git repository directory')
	.option('--status <file>', 'Path to status file (state.json) for tracking branch mappings')
	.option('--date <date>', 'Custom date to use for calculations (format: YYYY-MM-DD)')
	.parse(process.argv);

const options = program.opts();

// Validate command
if (!options.run && !options.dryRun && !options.verify && !options.init) {
	console.error('Error: Use one of --run, --dry-run, --verify, or --init');
	program.outputHelp();
	process.exit(ERROR_CODES.INVALID_COMMAND);
}

// Validate and parse custom date if provided
let customDate = null;
if (options.date) {
	const parsedDate = parseISO(options.date);
	if (isNaN(parsedDate.getTime())) {
		console.error(`[FATAL] Invalid date format: ${options.date}. Use YYYY-MM-DD`);
		process.exit(ERROR_CODES.INVALID_DATE);
	}
	customDate = parsedDate;
	console.log(`[INFO] Using custom date: ${format(customDate, 'yyyy-MM-dd')}`);
}

// Validate Git directory exists
if (options.git && !existsSync(options.git)) {
	console.error(`[FATAL] Git directory not found: ${options.git}`);
	process.exit(ERROR_CODES.FILE_NOT_FOUND);
}

// Resolve paths
const gitDir = options.git ? path.resolve(options.git) : null;
const statusPath = options.status ? path.resolve(options.status) : null;

// Run selected command with error handling
loadConfig(options.config)
	.then(config => {
		if (options.init) {
			return initializeBranches(config, gitDir, options.dryRun, statusPath, customDate);
		} else if (options.verify) {
			return verifyBranches(config, gitDir, customDate);
		} else {
			return runWorkflow(config, gitDir, options.dryRun, statusPath, customDate);
		}
	})
	.catch(error => {
		console.error(`[FATAL] Unhandled error: ${error.message}`);
		process.exit(1);
	});
    