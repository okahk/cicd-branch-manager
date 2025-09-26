#!/usr/bin/env node

const { program } = require('commander');
const simpleGit = require('simple-git');
const { differenceInCalendarDays, addWeeks, addDays, startOfWeek, isMonday, format, parseISO, parse, startOfDay } = require('date-fns');
const fs = require('fs').promises;
const path = require('path');
const { existsSync } = require('fs');

// Constants and configuration

// const { Console } = require('console');

// Helper function to get branch name from status (handles both old and new formats)
function getBranchName(branchStatus) {
	if (!branchStatus) return null;
	if (typeof branchStatus === 'string') {
		// Old format - direct string
		return branchStatus;
	} else if (typeof branchStatus === 'object' && branchStatus.branch) {
		// New format - object with branch property
		return branchStatus.branch;
	}
	return null;
}


// Helper function to get latest commit info from branch status
function extractBranchLatestCommit(branchStatus) {
	if (!branchStatus) return null;
	if (typeof branchStatus === 'object' && branchStatus.commit) { 
		return branchStatus.commit;
	}
	return null;
}


// Helper function to update branch status (handles both old and new formats)
function updateBranchStatus(currentStatus, newBranchName, commitInfo = null) {
	// console.log(currentStatus, newBranchName, commitInfo);
	if (currentStatus && typeof currentStatus === 'object' && currentStatus.branch) {
		// New format - update branch and optionally commit info
		const updated = { ...currentStatus, branch: newBranchName };
		if (commitInfo) {
			updated.commit = commitInfo;
		}
		return updated;
	} else {
		// Old format or new assignment - convert to new format
		const newStatus = { branch: newBranchName };
		if (commitInfo) {
			newStatus.latest = commitInfo;
		}
		return newStatus;
	}
}

// Default configuration
const DEFAULT_CONFIG = {
	baseBranch: 'base',
	uatBranch: 'uat',
	preBranch: 'pre',
	proBranch: 'pro',
	remoteName: 'origin',
	cycleDays: 14,
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
// symbols ⏩ 🆗 ❌ ⚠️ ✅ ✨️

const logInfo = (message) => console.info(`✨️ [INFO] ${message}`);
const logValid = (message) => console.log(`✅ [valid] ${message}`);
const logSuccess = (message) => console.log(`✅ [SUCCESS] ${message}`);
const logOK = (message) => console.log(`🆗 ${message}`);

const logWarn = (message) => console.warn(`⚠️ [WARN] ${message}`);
const logError = (message) => console.error(`❌ [ERROR] ${message}`);
const logAction = (message) => console.log(`   [ACTION] ${message}`);
const logLine = () => console.log(`=====================================================`);


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
			const rawStatus = JSON.parse(data);
			// Convert to unified format
			return normalizeStatusFormat(rawStatus);
		}
		logInfo(`Status file not found at ${statusPath}, creating new state`);
		return {};
	} catch (error) {
		exitWithError(ERROR_CODES.FILE_NOT_FOUND, `Failed to read status file: ${error.message}`);
	}
}

// Normalize status format to handle both old and new formats
function normalizeStatusFormat(rawStatus) {
	// Check if it's the new format (has nested structure with branch objects)
	if (rawStatus.base && typeof rawStatus.base === 'object' && rawStatus.base.branch) {
		// New format - preserve full structure
		return {
			base: rawStatus.base || { branch: null },
			uat: rawStatus.uat || { branch: null },
			pre: rawStatus.pre || { branch: null },
			pro: rawStatus.pro || { branch: null },
			lastCycleDate: rawStatus.lastCycleDate,
			aheadCycleDate: rawStatus.aheadCycleDate,
			branches: rawStatus.branches,
			_fullStatus: rawStatus // Preserve full structure for saving
		};
	} else {
		// Old format - convert to new format
		return {
			base: { branch: rawStatus.base || null },
			uat: { branch: rawStatus.uat || null },
			pre: { branch: rawStatus.pre || null },
			pro: { branch: rawStatus.pro || null },
			lastCycleDate: rawStatus.lastCycleDate,
			aheadCycleDate: rawStatus.aheadCycleDate,
			branches: rawStatus.branches
		};
	}
}

// Save state to status file or exit on failure
async function saveStatusFile(statusPath, state) {
	if (!statusPath) return;
	try {
		// Convert to the appropriate format for saving
		const saveFormat = convertToSaveFormat(state);
		await fs.writeFile(statusPath, JSON.stringify(saveFormat, null, "\t"), 'utf8');
		logInfo(`Updated state file: ${statusPath}`);
	} catch (error) {
		exitWithError(ERROR_CODES.FILE_NOT_FOUND, `Failed to write status file: ${error.message}`);
	}
}

// Convert internal state to save format
function convertToSaveFormat(state) {
	// If we have the full status structure, update it and return
	if (state._fullStatus) {
		const fullStatus = { ...state._fullStatus };

		// Update branch objects in the full structure
		if (state.base && fullStatus.base) {
			fullStatus.base.branch = getBranchName(state.base);
			if (state.base.commit) fullStatus.base.commit = state.base.commit;
		}
		if (state.uat && fullStatus.uat) {
			fullStatus.uat.branch = getBranchName(state.uat);
			if (state.uat.commit) fullStatus.uat.commit = state.uat.commit;
		}
		if (state.pre && fullStatus.pre) {
			fullStatus.pre.branch = getBranchName(state.pre);
			if (state.pre.commit) fullStatus.pre.commit = state.pre.commit;
		}
		if (state.pro && fullStatus.pro) {
			fullStatus.pro.branch = getBranchName(state.pro);
			if (state.pro.commit) fullStatus.pro.commit = state.pro.commit;
		}

		// Update cycle dates
		if (state.lastCycleDate) fullStatus.lastCycleDate = state.lastCycleDate;
		if (state.aheadCycleDate) fullStatus.aheadCycleDate = state.aheadCycleDate;
		if (state.branches) fullStatus.branches = state.branches;

		// Remove internal properties
		delete fullStatus._fullStatus;

		return fullStatus;
	} else {
		// Create new format structure
		const newFormat = {
			base: { branch: getBranchName(state.base) },
			uat: { branch: getBranchName(state.uat) },
			pre: { branch: getBranchName(state.pre) },
			pro: { branch: getBranchName(state.pro) },
			lastCycleDate: state.lastCycleDate,
			aheadCycleDate: state.aheadCycleDate,
			branches: state.branches
		};

		// Add latest commit info if available
		if (state.base && state.base.commit) newFormat.base.commit = state.base.commit;
		if (state.uat && state.uat.commit) newFormat.uat.commit = state.uat.commit;
		if (state.pre && state.pre.commit) newFormat.pre.commit = state.pre.commit;
		if (state.pro && state.pro.commit) newFormat.pro.commit = state.pro.commit;

		return newFormat;
	}
}

function calculateNextCycleDateString(lastCycleDateString, cycleDays = 14, dateFormat = "yyyy-MM-dd") {
	if (lastCycleDateString) {
		// return addDays(lastCycleDate, cycleDays);
		return format(addDays(parseISO(lastCycleDateString), cycleDays), dateFormat);
	} else {
		// return today
		return format(new Date(), dateFormat);
	}
}

function calculateCycleDateInfo(config, status, currentDateString, cycleDays = 14, dateFormat = "yyyy-MM-dd") {
	var nextDate;
	var aheadDate;

	if (status.lastCycleDate) // string
	{
		var today = parse(currentDateString, dateFormat, new Date());
		const lastCycleDate = parse(status.lastCycleDate, config.dateFormat, new Date());
		var dayDiff = differenceInCalendarDays(today, lastCycleDate);
		var days = Math.floor(dayDiff / cycleDays) * cycleDays;
		nextDate = addDays(lastCycleDate, days);
		aheadDate = addDays(nextDate, cycleDays);
	} else {
		const currentDate = startOfDay(new Date())
		nextDate = currentDate;
		aheadDate = addDays(nextDate, cycleDays);
	}
	return {
		current: format(nextDate, dateFormat),
		next: format(aheadDate, dateFormat)
	}
}

function updateNextCycleBranches(config, status, currentDateString, cycleDays = 14, branchPrefix = '', dateFormat = "yyyy-MM-dd") {
	var nextDate;
	var aheadDate;
	if (status.lastCycleDate) // string
	{
		var today = parse(currentDateString, dateFormat, new Date());
		const lastCycleDate = parse(status.lastCycleDate, config.dateFormat, new Date());
		var dayDiff = differenceInCalendarDays(today, lastCycleDate);
		var days = Math.floor(dayDiff / cycleDays) * cycleDays;
		nextDate = addDays(lastCycleDate, days);
		aheadDate = addDays(nextDate, cycleDays);
	} else {
		const currentDate = startOfDay(new Date())
		nextDate = currentDate;
		aheadDate = addDays(nextDate, cycleDays);
	}

	var obj = {
		aheadCycleDate: format(aheadDate, dateFormat),
		nextCycleDate: format(nextDate, dateFormat),
		newBaseBranch: config.branchPrefix ? `${config.branchPrefix}/${format(nextDate, dateFormat)}` : format(nextDate, dateFormat),
		currentBranch: getBranchName(status.base),
		uatSourceBranch: getBranchName(status.uat),
		proSourceBranch: getBranchName(status.pro),
	}

	if (obj.proSourceBranch != obj.uatSourceBranch) {
		logInfo(`set pro to ${obj.uatSourceBranch}`);
		obj.proSourceBranch = obj.uatSourceBranch;
	}
	if (obj.uatSourceBranch != obj.currentBranch) {
		// pre branch rebase to status.base
		// set status.pre = status.base
		logInfo(`set uat to ${obj.currentBranch}`)
		obj.uatSourceBranch = obj.currentBranch;
	}
	return obj;
}

// Updated calculateBranchDates to use days instead of weeks
function calculateBranchDates(config, status, dateString, cycleDays = 14, branchPrefix = '', dateFormat = "yyyy-MM-dd") {
	return {
		newBaseBranch: getBranchName(status.base),
		uatSourceBranch: getBranchName(status.uat),
		proSourceBranch: getBranchName(status.pro),
	}
}

// Check if specified date is a valid execution day based on last cycle from status
function isExecutionDay(dateFormat, currentDate, cycleDays = 14, lastCycleDate = null) {
	// If no last cycle date exists (first run), consider it an execution day
	if (!lastCycleDate) return true;

	var today = parse(currentDate, dateFormat, new Date());
	var lastTime = parse(lastCycleDate, dateFormat, new Date());
	const dayDiff = differenceInCalendarDays(today, lastTime);
	// Return true if difference is at least cycleDays
	return dayDiff >= cycleDays;
}


// Git operations handler with strict error checking
class GitOperations {
	constructor(config, gitDir, dryRun = false) {
		this.gitDir = gitDir || process.cwd();
		this.simpleGit = simpleGit({
			baseDir: this.gitDir,
			binary: 'git',
			maxConcurrentProcesses: 1
		});
		if (config.debug) {
			this.simpleGit.outputHandler((command, stdout, stderr) => {
				console.log("command", command);
				stdout.on('data', (data) => {
					console.log(`[stdout] ${data}`);
				});
				stderr.on('data', (data) => {
					console.error(`[stderr] ${data}`);
				});
			});
		}
		this.config = config;
		this.dryRun = dryRun;
		this.currentBranch = null;
	}

	async execute(command, actionDescription, critical = true) {
		console.log(`=== ${actionDescription} ===`);
		// logAction(actionDescription);
		// logInfo(`[GIT DIR] ${this.gitDir}`);

		if (this.dryRun) {
			logInfo(`[DRY RUN] Would execute this action`);
			return { success: true, dryRun: true };
		}

		try {
			const result = await command();
			// logSuccess('Operation completed');
			console.log("   ✅")
			return { success: true, result };
		} catch (error) {
			console.error(`   ❌ ${error.message}`);
			if (critical) exitWithError(ERROR_CODES.GIT_OPERATION_FAILED, 'Critical operation failed - exiting');
			return { success: false, error };
		}
	}

	async getCurrentBranch() {
		if (this.currentBranch) return this.currentBranch;

		try {
			const status = await this.simpleGit.status();
			this.currentBranch = status.current;
			return this.currentBranch;
		} catch (error) {
			logError(`Failed to get current branch: ${error.message}`);
			return null;
		}
	}
	async remoteBranchExists(branch) {
		const remoteBranches = await this.simpleGit.raw([
			'ls-remote', '--heads', this.config.remoteName, branch
		]);
		return remoteBranches.trim() !== '';
	}
	async branchExists(branch) {
		try {
			const localBranches = await this.simpleGit.branchLocal();
			if (localBranches.all.includes(branch)) return true;

			const remoteBranches = await this.simpleGit.raw([
				'ls-remote', '--heads', this.config.remoteName, branch
			]);
			return remoteBranches.trim() !== '';
		} catch (error) {
			exitWithError(ERROR_CODES.GIT_OPERATION_FAILED, `Failed to check branch existence: ${error.message}`);
		}
	}

	async getLatestCommitInfo(branch) {
		try {
			// console.log("checkout", branch);
			await this.simpleGit.checkout(branch);
			// console.log("call log");
			const log = await this.simpleGit.log({ maxCount: 1 });
			if (log.latest) {
				var commit = log.latest;
				return {
					hash: commit.hash,
					date: commit.date,
					message: commit.message,
					refs: commit.refs,
					body: commit.body || '',
					author_name: commit.author_name,
					author_email: commit.author_email
				};
			}
			return null;
		} catch (error) {
			logError(`Failed to get commit info for ${branch}: ${error.message}`);
			return null;
		}
	}

	async pull(branch, critical = true) {
		return this.execute(
			async () => {
				await this.simpleGit.checkout(branch);
				// var result = await this.simpleGit.pull();
				// this.evaluateGitResult(result);
				var result = await this.simpleGit.pull(this.config.remoteName, branch);
				this.evaluateGitResult(result);
			},
			`Pulling from ${this.config.remoteName}/${branch} ⬇️`,
			critical
		);
	}
	async checkout(branch) {
		return await this.simpleGit.checkout(branch);
	}

	async createBranch(fromBranch, newBranch, critical = true) {
		if (await this.branchExists(newBranch)) {
			logWarn(`Branch ${newBranch} already exists. Skipping creation.`);
			return { success: true, existed: true };
		}
		return this.execute(
			async () => {
				await this.simpleGit.checkout(fromBranch);
				await this.simpleGit.pull(this.config.remoteName, fromBranch);

				// 創建新分支
				await this.simpleGit.checkoutBranch(newBranch, fromBranch);

				// 為新分支創建一個空提交來確保它有獨立的歷史
				// 這樣後續從這個分支創建其他分支就不會有問題
				await this.simpleGit.commit('CICD Initial branch commit', ['--allow-empty']);
			},
			`Creating branch ${newBranch} from ${fromBranch}`,
			critical
		);
	}
	async emptyCommit(message) {
		// await this.git.commit('CICD Initial branch commit', ['--allow-empty']);
		await this.simpleGit.commit(message, ['--allow-empty']);
	}

	async rebase(branch, ontoBranch, critical = true) {
		return this.execute(
			async () => {
				await this.simpleGit.checkout(branch);
				await this.simpleGit.pull(this.config.remoteName, branch);
				await this.simpleGit.rebase(ontoBranch);
			},
			`Rebasing ${branch} onto ${ontoBranch}`,
			critical
		);
	}
	async reset(from, to, critical = true)
	{
		return this.execute(
			async () => {
				await this.simpleGit.checkout(to);
				await this.simpleGit.reset(['--hard']);
				logWarn("Reset to last commit.");
			},
			`Reset (${from}) → (${to}) }`,
			critical
		);
	}
	async merge(branch, fromBranch, noFastForward = false, critical = true) {
		const options = noFastForward ? ['--no-ff'] : [];
		return this.execute(
			async () => {
				// console.log("checkout", branch);
				await this.simpleGit.checkout(branch);
				if (await this.remoteBranchExists(branch)) {
					// console.log("pull", this.config.remoteName, branch);
					await this.simpleGit.pull(this.config.remoteName, branch);
				} else {
					logWarn("remote branch not exists", branch);
				}
				// console.log("merge", [fromBranch, ...options]);
				var result = await this.simpleGit.merge([fromBranch, ...options]);
				if (result.failed) {
					console.log("Merge failed:", result.failed);
					// Abort the merge if possible
					try {
						await this.simpleGit.merge(['--abort']);
						logWarn("Merge aborted.");
					} catch (abortErr) {
						logWarn("Merge abort failed, performing hard reset...");
						await this.simpleGit.reset(['--hard']);
						logWarn("Reset to last commit.");
					}
				} else {
					this.evaluateGitResult(result);
				}
			},
			`Merging (${fromBranch}) → (${branch}) ${noFastForward ? '(with merge commit)' : ''}`,
			critical
		);
	}
	async evaluateGitResult(result) {

		if (!result) return;
		if (
			result.pushed &&
			result.pushed.length > 0 &&
			result.pushed.every(p => p.alreadyUpdated)
		) {
			console.log("Everything up-to-date");
		} else if (result.summary) {
			if (result.summary.changes > 0) {
				console.log(`changed ${result.summary.changes}`);
			} else if (result.summary.changes == 0) {
				console.log("Everything up-to-date");
			}
		} else {
			// console.log("result", result);

		}
	}
	async push(branch, force = false, critical = true) {
		const options = force ? ['--force-with-lease'] : [];
		return this.execute(
			async () => {
				const result = await this.simpleGit.push(this.config.remoteName, branch, options);
				this.evaluateGitResult(result);
			},
			`Pushing ${branch} to ${this.config.remoteName} ${force ? '(force)' : ''}`,
			critical
		);
	}

	async branchesDiverged(branch1, branch2) {
		if (this.dryRun) return true;

		try {
			await this.simpleGit.raw(['merge-base', '--is-ancestor', branch1, branch2]);
			return false;
		} catch (error) {
			if (error.code === 1) return true;
			exitWithError(ERROR_CODES.GIT_OPERATION_FAILED, `Failed to check branch divergence: ${error.message}`);
		}
	}

	deleteBranch(branch, critical = false) {
		// console.log("deleteBranch", branch);
		return this.execute(
			async () => {
				// console.log("X1");
				console.log("deleteLocalBranch", branch);
				try {
					var a = await this.simpleGit.deleteLocalBranch(branch);
					console.log(a);
					await this.simpleGit.push(this.config.remoteName, `:${branch}`);
				} catch (error) {
					console.error("some error", error);
				}

			},
			`Deleting branch ${branch} (local and remote)`,
			critical
		);
	}
}

async function emptyCommit(git, config, gitDir, dryRun, statusPath, customDate = null) {
	await git.checkout(config.baseBranch);
	await git.emptyCommit("emptyCommit");
	await git.push(config.baseBranch);
}

// Initialize required date-based branches with strict error handling
async function initializeBranches(git, config, gitDir, dryRun, statusPath, customDate = null) {
	let status = await loadStatusFile(statusPath);
	const currentDateString = customDate || getTodayString(config.dateFormat);
	
	var dateInfo = calculateCycleDateInfo(config, status, currentDateString, config.cycleDays, config.dateFormat);
	
	var newBaseBranch = formatBranchName(config, dateInfo.current);
	var proBranch = formatBranchName(config, "x1");
	var preBranch = formatBranchName(config, "x2");

	
	if (!status.base.branch) status.base.branch = newBaseBranch;
	if (!status.uat.branch) status.uat.branch = preBranch;
	if (!status.pre.branch) status.pre.branch = preBranch;
	if (!status.pro.branch) status.pro.branch = proBranch;
	
	status.lastCycleDate = dateInfo.current;
	status.aheadCycleDate = dateInfo.next;

	var items = [
		{
			key:"base",
			prev:null,
			current: config.baseBranch,
			next: status.base.branch
		},
		{
			
			key:"uat",
			prev:status.base.branch,
			current: status.uat.branch,
			next: config.uatBranch
			
		},
		{
			key:"pre",
			prev:status.base.branch,
			current: status.pre.branch,
			next:config.preBranch
			
		},
		{
			key:"pro",
			prev:config.preBranch,
			current: status.pro.branch,
			next: config.proBranch
			
		}
	];
	
	console.log(`=== Initializing Required Branches ===`);
	console.log(`Using date: ${currentDateString}`);
	console.log(`Git directory: ${gitDir || process.cwd()}`);
	console.log(`Target branches:`, {
		base: getBranchName(status.base),
		uat: getBranchName(status.uat),
		pre: getBranchName(status.pre),
		pro: getBranchName(status.pro)
	});
	
	for (const item of items) {
		var prevExists = item.prev ? await git.branchExists(item.prev) : false;
		var currentExists = await git.branchExists(item.current);
		var nextExists = await git.branchExists(item.next);
		// console.log(prevExists, currentExists, nextExists);
		if(!prevExists && !currentExists && !nextExists)
			exitWithError(ERROR_CODES.MISSING_BRANCHES, `Source branch ${item.prev ? item.prev  : item.current} does not exist`);
		var toDoList = [];

		if(prevExists && !currentExists && !nextExists)
		{
			toDoList.push({
				from:item.prev,
				to:item.current
			});
			toDoList.push({
				from:item.current,
				to:item.next
			});
		} 
		if(currentExists)
		{
			toDoList.push({
				from:item.current,
				to:item.next
			});
		}
		if(nextExists)
		{
			toDoList.push({
				from:item.next,
				to:item.current
			});
		}

		for (const item of toDoList) {
			// await git.mergeBranches(item.from, item.to, true);
			if (await git.branchExists(item.to)) {
				const mergeResult = await git.merge(item.to, item.from, false, true);
				// console.log(mergeResult);
				// if (mergeResult && mergeResult.success) {
			} else {
				const createResult = await git.createBranch(item.from, item.to);
				
				if (createResult.success && !dryRun) {
					// Get latest commit info for the new branch
					await git.checkout(item.from);
					await git.emptyCommit("CICD Initial branch commit");
					await git.checkout(item.from);
					await git.push(item.to);
					
				} else if (dryRun) {
					logInfo(`[DRY RUN] Would create ${item.to} from ${item.from}`);
				} else {
					exitWithError(ERROR_CODES.GIT_OPERATION_FAILED, `Failed to create ${item.to}`);
				}
			}
				

		}
		
	}

	
	
	for (const item of items) {
		// console.log("__checkout ", item.current, "________");
		await git.checkout(item.current);
		// console.log("get getLatestCommitInfo", item.current);
		const commitInfo = await git.getLatestCommitInfo(item.current);
		if (commitInfo) {
			// console.log("key", item.current, item.key, commitInfo.hash);
			// Update status with commit info
			status[item.key].commit = commitInfo;
		}
	}

	if (statusPath) await saveStatusFile(statusPath, status);

	console.log("");
	logOK('=== Initialization Complete ===');
}

// Verify all required branches exist or exit
async function verifyBranches(git, config, statusPath, gitDir, customDate = null) {
	let status = await loadStatusFile(statusPath) || {};
	const currentDate = customDate || getTodayString(config.dateFormat);

	console.log(`=== CI/CD Branch Verification ===`);
	console.log(`Using date: ${currentDate}`);
	console.log(`Repository: ${gitDir || process.cwd()}`);

	var branches = calculateBranchDates(config, status, currentDate, config.cycleDays, config.branchPrefix, config.dateFormat);
	const { newBaseBranch, uatSourceBranch, proSourceBranch } = branches;
	const requiredBranches = [
		config.baseBranch,
		newBaseBranch,

		uatSourceBranch,
		config.uatBranch,
		config.preBranch,

		proSourceBranch,
		config.proBranch
	];

	console.log('\nChecking required branches:');
	let missing = false;

	for (const branch of requiredBranches) {
		const exists = await git.branchExists(branch);
		if (exists) {
			logValid(`${branch}`);
		} else {
			logError(`${branch} (missing)`);
			missing = true;
		}
	}

	// Show latest commit info if available
	console.log('\n=== Latest Commit Information ===');
	const branchTypes = ['base', 'uat', 'pre', 'pro'];
	for (const type of branchTypes) {
		const branchName = getBranchName(status[type]);
		const commitInfo = extractBranchLatestCommit(status[type]);
		if (commitInfo) {
			console.log(`${type.toUpperCase()}: ${branchName}`);
			console.log(`  Hash: ${commitInfo.hash}`);
			console.log(`  Date: ${commitInfo.date}`);
			console.log(`  Message: ${commitInfo.message}`);
			console.log(`  Author: ${commitInfo.author_name} <${commitInfo.author_email}>`);
			console.log('');
		}
	}

	console.log('\n=== Verification Result ===');
	if (missing) {
		logError('Missing required branches - fix before running workflow');
		process.exit(ERROR_CODES.MISSING_BRANCHES);
	} else {
		console.log('✅  All required branches exist');
	}
}

function formatBranchName(config, branch) {
	return config.branchPrefix ? `${config.branchPrefix}/${branch}` : branch;
}
function sameCommitInfo(commitInfo1, commitInfo2)
{
	if (!commitInfo1 || !commitInfo2) {
		return false;
	}
	
	if (commitInfo1.hash === commitInfo2.hash) return true;
	return false;
}
async function mergeBranches(config, git, currentDate, gitDir, dryRun, status, customDate = null) {
	console.log("\n=== Merge or Rebase Branches ===");
	logInfo(`${currentDate} Merge or Rebase Branches`);

	// await git.checkout(config.baseBranch);
	await git.pull(config.baseBranch);

	var items = [];
	if (status.aheadCycleDate) {
		var branch = formatBranchName(config, status.aheadCycleDate);
		if (await git.remoteBranchExists(branch)) {
			
			items.push(
				{
					type: "merge",
					name: 'base',
					key:"base",
					ref:config.baseBranch,
					commit: extractBranchLatestCommit(status.base),
					from: config.baseBranch, // base
					to: branch // date
				},
			);
		}
	}

	items.push(
		{
			type: "merge",
			name: 'base',
			key: "base",
			branchName:status.base.branch,
			commit:status.base.commit,
			from: config.baseBranch, // base
			to: status.base.branch // date
		},
		{
			type: "merge",
			name: 'uat',
			key: "uat",
			branchName:status.uat.branch,
			commit:status.uat.commit,
			from: status.uat.branch, // uat
			to: config.uatBranch // date
		},
		{
			type: "merge",
			name: 'pre',
			key: "pre",
			branchName:status.pre.branch,
			commit:status.pre.commit,
			from: status.pre.branch, // pre
			to: config.preBranch // date
		},
		{
			type: "merge",
			name: 'pro',
			key: "pro",
			branchName:status.pro.branch, // pro
			commit:status.pro.commit,
			from: status.pro.branch, // pro
			to: config.proBranch // date
		}
	);
	var hasError = false;
	for (const item of items) {
		const { name, from, to, commit, branchName } = item;
		logLine();
		if (item.type == "merge") {
			// var latest = getLatestCommitInfo(item.latest);
			const commitInfo = await git.getLatestCommitInfo(item.from);
			console.log(name);
			if(sameCommitInfo(commitInfo, item.commit)) {
				logInfo(`⏩ ${from} has not change ⏩`);
			} else {
				const mergeResult = await git.merge(to, from, false, false)
				if (mergeResult && mergeResult.success) {
					// Update commit info after successful merge
					const commitInfo = await git.getLatestCommitInfo(from);
					if (commitInfo) {
						status[item.key].commit = commitInfo;//  = updateBranchStatus(status[key], branchName, commitInfo);
					}
				} else {
					hasError = true;
				}
			}
			
		}
	}
	logLine();
	if (hasError) {
		logError('Merge or Rebase Failed');
		process.exit(ERROR_CODES.MERGE_FAILED);
	}

}

function logBranchInfo(status, branches) {
	const { newBaseBranch, uatSourceBranch, proSourceBranch } = branches;
	console.log(`=== Cycle Information ===`);
	console.log(`base: (${getBranchName(status.base)}) → (${newBaseBranch})`);
	console.log(`UAT: (${getBranchName(status.uat)}) → (${uatSourceBranch})`);
	console.log(`PRO: (${getBranchName(status.pro)}) → (${proSourceBranch})`);
}

async function createBranches(config, git, currentDateString, gitDir, dryRun, status, customDate = null) {
	// await git.checkout(config.baseBranch);
	await git.pull(config.baseBranch);

	const branches = updateNextCycleBranches(config, status, currentDateString, config.cycleDays, config.branchPrefix, config.dateFormat);
	logBranchInfo(status, branches);
	const { newBaseBranch, uatSourceBranch, proSourceBranch } = branches;

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
	if (!status.branches) status.branches = [];
	status.branches.push({
		branch: newBaseBranch,
		time: new Date().getTime()
	});

	if (await git.branchExists(newBaseBranch)) {
		logInfo(`Base branch (${newBaseBranch}) already exists. Skipping creation.`);
	} else {
		const createResult = await git.createBranch(config.baseBranch, newBaseBranch);
		if (!createResult.success) exitWithError(ERROR_CODES.GIT_OPERATION_FAILED, 'Failed to create new base branch');

		// Get commit info for the new branch
		const commitInfo = await git.getLatestCommitInfo(newBaseBranch);
		await git.push(newBaseBranch);
	}

	// rebase or merege, reset, delete, git flow
	var items = [
		{
			type:"merge",
			name:"=== Merge Ahead base to Branch ===",
			from:status.base.branch,
			to:newBaseBranch,
			noFastForward:false
		},
		{
			type:"rebase",
			name:'=== Updating UAT Branch ===',
			from:newBaseBranch,
			to:uatSourceBranch,
			noFastForward:false,
		},
		{
			type:"rebase",
			name:'=== Updating PRE Branch ===',
			from:uatSourceBranch,
			to:proSourceBranch,
			noFastForward:true
		},
		{
			type:"rebase", 
			name:'=== Updating PRO Branch ===',
			from:proSourceBranch,
			to:config.proBranch,
			noFastForward:true
		}
	];
	for (const item of items) {
		logLine();
		console.log(item.name);
		
		if(item.type == "rebase")
		{
			await git.rebase(item.to, item.from, true);
		} else if(item.type == "merge")
		{
			await git.merge(item.to, item.from, true);
		} else if(item.type == "reset")
		{
			await git.reset(item.from, item.to, true);
		} else if(item.type == "delete")
		{
			// not implement	
			await git.delete(item.to);
			await git.push(item.to);
			// 
			await git.createBranch(item.from, item.to);
		}
	}
	/*
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
	*/
	console.log('\n=== Updating State ===');
	// Get latest commit info for all branches
	const baseCommitInfo = await git.getLatestCommitInfo(newBaseBranch);
	const uatCommitInfo = await git.getLatestCommitInfo(uatSourceBranch);
	const proCommitInfo = await git.getLatestCommitInfo(proSourceBranch);

	const newState = {
		base: updateBranchStatus(status.base, newBaseBranch, baseCommitInfo),
		uat: updateBranchStatus(status.uat, uatSourceBranch, uatCommitInfo),
		pre: updateBranchStatus(status.pre, uatSourceBranch, uatCommitInfo),
		pro: updateBranchStatus(status.pro, proSourceBranch, proCommitInfo),
		nextCycleDate: branches.aheadCycleDate,
		lastCycleDate: branches.nextCycleDate
	};

	Object.assign(status, newState);

	console.log('\n=== Workflow Complete ===');
	logSuccess('All operations completed successfully!');
}

// Main workflow execution with strict error handling
function getTodayString(dateFormat) {
	const date = new Date();
	return format(date, dateFormat);
}
/*
function logDataObject(name, obj) {
	console.log(`${name}:`)
	for (var key in obj) {
		if (key === 'base' || key === 'uat' || key === 'pre' || key === 'pro') {
			console.log(`    ${key}: ${getBranchName(obj[key])}`);
			const latestCommit = extractBranchLatestCommit(obj[key]);
			if (latestCommit) {
				console.log(`      Latest commit: ${latestCommit.hash.substring(0, 8)} - ${latestCommit.message}`);
			}
		} else {
			console.log(`    ${key}: ${obj[key]}`);
		}
	}
}
*/
/*
function logSummary(options, config, status, today, gitDir) {
	console.log(`=== CI/CD Branch Management Tool ===`);
	logDataObject("command line options", options);
	logDataObject("config.json", config);
	logDataObject("status.json", status);
}
*/

async function removeOldBranches(config, status, git) {
	if (config.autoRemoveBranches && status.branches) {
		console.log(`\n=== Removing Old Branches ===`);
		const retentionCycles = config.branchRetentionCycles || 3;
		const retentionTime = retentionCycles * config.cycleDays;
		const cutoffDate = addDays(new Date(), -retentionTime);

		const branchesToRemove = status.branches.filter(branchInfo => {
			const branchDate = new Date(branchInfo.time);
			return branchDate < cutoffDate;
		});

		for (const branchInfo of branchesToRemove) {
			const branch = branchInfo.branch;
			if (await git.branchExists(branch)) {
				logInfo(`Removing old branch: ${branch}`);
				await git.deleteBranch(branch, false);
			}
		}

		// Update branches list
		status.branches = status.branches.filter(branchInfo => {
			const branchDate = new Date(branchInfo.time);
			return branchDate >= cutoffDate;
		});
	}
}


// Command handlers
const commandHandlers = [
	{ 
		name: 'fake', 
		description: 'Empty Message Commit', 
		handler: async (opts) => { 
			const config = await loadConfig(opts.config);
			const git = new GitOperations(config, config.git, opts.dryRun);
			await emptyCommit(git, config, config.git, opts.dryRun, opts.status, opts.date);
		}, 
	},
	{ 
		name: 'init', 
		description: 'Initialize required branches', 
		handler: async (opts) => {
			const config = await loadConfig(opts.config);
			const git = new GitOperations(config, config.git, opts.dryRun);
			await initializeBranches(git, config, config.git, opts.dryRun, opts.status, opts.date);
		},
	},
	{ 
		name: 'verify', 
		description: 'Verify all required branches exist', 
		handler: async (opts) => {
			const config = await loadConfig(opts.config);
			const git = new GitOperations(config, config.git, opts.dryRun);
			await verifyBranches(git, config, opts.status, config.git, opts.date);
		}
	},
	{ 
		name: 'merge', 
		description: 'Merge branches according to workflow', 
		handler: async (opts) => {
			const config = await loadConfig(opts.config);
			const git = new GitOperations(config, config.git, opts.dryRun);
			const status = await loadStatusFile(opts.status);
			const currentDate = opts.date || getTodayString(config.dateFormat);

			await mergeBranches(config, git, currentDate, config.git, opts.dryRun, status, opts.date);
			await saveStatusFile(opts.status, status);
		}
	},
	{ 
		name: 'run', 
		description: 'Execute complete workflow (create + merge)', 
		handler: async (opts) => {
			const config = await loadConfig(opts.config);
			const git = new GitOperations(config, config.git, opts.dryRun);
			const status = await loadStatusFile(opts.status);
			const currentDate = opts.date || getTodayString(config.dateFormat);

			console.log(`=== CI/CD Workflow Execution ===`);
			console.log(`Date: ${currentDate}`);
			console.log(`Repository: ${config.git || process.cwd()}`);

			if (isExecutionDay(config.dateFormat, currentDate, config.cycleDays, status.lastCycleDate)) {
				await createBranches(config, git, currentDate, config.git, opts.dryRun, status, opts.date);
				await removeOldBranches(config, status, git);
			} else {
				await mergeBranches(config, git, currentDate, config.git, opts.dryRun, status, opts.date);
			}
			await saveStatusFile(opts.status, status);
			logSuccess('Workflow completed successfully!');
		},
	},
	{
		name: 'workflow', 
		description: 'Execute complete workflow (create + merge)', 
		handler: async (opts) => {
			const config = await loadConfig(opts.config);
			const git = new GitOperations(config, config.git, opts.dryRun);
			const status = await loadStatusFile(opts.status);
			const currentDate = opts.date || getTodayString(config.dateFormat);

			console.log(`=== CI/CD Workflow Execution ===`);
			console.log(`Date: ${currentDate}`);
			console.log(`Repository: ${config.git || process.cwd()}`);

			if (!isExecutionDay(config.dateFormat, currentDate, config.cycleDays, status.lastCycleDate)) {
				logWarn(`Not an execution day (cycle: ${config.cycleDays} days)`);
				logWarn(`Last cycle: ${status.lastCycleDate}`);
				logWarn(`Next cycle: ${calculateNextCycleDateString(status.lastCycleDate, config.cycleDays, config.dateFormat)}`);
				return;
			}

			await createBranches(config, git, currentDate, config.git, opts.dryRun, status, opts.date);
			await removeOldBranches(config, status, git);
			await saveStatusFile(opts.status, status);
			logSuccess('Workflow completed successfully!');
		}
	},
	{ 
		name: 'status', 
		description: 'Show current status', 
		handler: async (opts) => {
			const config = await loadConfig(opts.config);
			const status = await loadStatusFile(opts.status);
			const currentDate = opts.date || getTodayString(config.dateFormat);
			displayStatusInfo(currentDate, status, config);
		}
	}
	
];

// Helper functions
function displayStatusInfo(currentDate, status, config) {
	console.log(`=== Current Status ===`);
	console.log(`Date: ${currentDate}`);
	console.log(`Last cycle date: ${status.lastCycleDate || 'Never'}`);
	console.log(`Next cycle date: ${status.aheadCycleDate || 'Not set'}`);

	console.log('\n=== Branch Information ===');
	const branchTypes = ['base', 'uat', 'pre', 'pro'];

	branchTypes.forEach(type => {
		const branchName = getBranchName(status[type]);
		const commitInfo = extractBranchLatestCommit(status[type]);

		console.log(`${type.toUpperCase()}: ${branchName || 'Not set'}`);
		if (commitInfo) {
			console.log(`  Latest commit: ${commitInfo.hash.substring(0, 8)}`);
			console.log(`  Date: ${commitInfo.date}`);
			console.log(`  Message: ${commitInfo.message}`);
		}
		console.log('');
	});

	if (status.branches?.length > 0) {
		console.log('=== Tracked Branches ===');
		status.branches.forEach(branchInfo => {
			console.log(`- ${branchInfo.branch} (created: ${new Date(branchInfo.time).toLocaleDateString()})`);
		});
	}
}

function setupGlobalOptions() {
	program
		.version('1.0.0')
		.description('CI/CD Branch Management Tool')
		.option('-c, --config <path>', 'Path to config file', DEFINT_COMMAND_LINE_CONFIG.config)
		.option('-s, --status <path>', 'Path to status file', DEFINT_COMMAND_LINE_CONFIG.status)
		.option('-d, --dry-run', 'Dry run mode (no changes)', DEFINT_COMMAND_LINE_CONFIG.dryRun)
		.option('-g, --git-dir <path>', 'Git repository directory', DEFINT_COMMAND_LINE_CONFIG.gitDir)
		.option('-t, --date <date>', 'Custom date (YYYY-MM-DD)')
		.option('-v, --verbose', 'Verbose output')
		.option('--debug', 'Debug mode');
}

function registerCommands() {
	/*
	const commands = [
		{ name: 'fake', description: 'Empty Message Commit', handler: commandHandlers.emptyCommit },
		{ name: 'init', description: 'Initialize required branches', handler: commandHandlers.init },
		{ name: 'verify', description: 'Verify all required branches exist', handler: commandHandlers.verify },
		{ name: 'merge', description: 'Merge branches according to workflow', handler: commandHandlers.merge },
		{ name: 'run', description: 'Execute complete workflow (create + merge)', handler: commandHandlers.run },
		{ name: 'workflow', description: 'Execute complete workflow (create + merge)', handler: commandHandlers.workflow },
		{ name: 'status', description: 'Show current status', handler: commandHandlers.status }
	];
	*/
	commandHandlers.forEach(({ name, description, handler }) => {
		program
			.command(name)
			.description(description)
			.action(async () => {
				try {
					await handler(program.opts());
				} catch (error) {
					console.error(`Error executing ${name} command:`, error);
					process.exit(1);
				}
			});
	});
}

// Main function
async function main() {
	try {
		setupGlobalOptions();
		registerCommands();

		program.parse(process.argv);

		if (process.argv.length === 2) {
			program.outputHelp();
		}
	} catch (error) {
		console.error('Fatal error:', error);
		process.exit(1);
	}
}

main().catch(console.error);