#!/usr/bin/env node

const { program } = require('commander');
const simpleGit = require('simple-git');
const { differenceInCalendarDays, addWeeks, addDays, startOfWeek, isMonday, format, parseISO, parse, startOfDay } = require('date-fns');
const fs = require('fs').promises;
const path = require('path');
const { existsSync } = require('fs');
// const { Console } = require('console');

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

const logInfo = (message) => console.info(`✨️ [INFO] ${message}`);
const logValid = (message) => console.log(`✅ [valid] ${message}`);
const logSuccess = (message) => console.log(`✅ [SUCCESS] ${message}`);
const logOK = (message) => console.log(`🆗 ${message}`);

const logWarn = (message) => console.warn(`⚠️ [WARN] ${message}`);
const logError = (message) => console.error(`❌ [ERROR] ${message}`);
const logAction = (message) => console.log(`---[ACTION] ${message}`);


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
        // console.log("saving", statusPath, state);
        await fs.writeFile(statusPath, JSON.stringify(state, null, "\t"), 'utf8');
        // console.log("");
        logInfo(`Updated state file: ${statusPath}`);
    } catch (error) {
        exitWithError(ERROR_CODES.FILE_NOT_FOUND, `Failed to write status file: ${error.message}`);
    }
}

function calculateNextCycleDateString(lastCycleDateString, cycleDays = 14, dateFormat = "yyyy-MM-dd") {
    if(lastCycleDateString)
    {
        // return addDays(lastCycleDate, cycleDays);
        return format(addDays(parseISO(lastCycleDateString), cycleDays), dateFormat);
    } else {
        // return today
        return format(new Date(), dateFormat);
    }
}

function calculateCycleDateString(config, status, currentDateString, dateFormat = "yyyy-MM-dd")
{
    var nextDate;
    if(status.lastCycleDate) // string
	{
        var today = parse(currentDateString, dateFormat, new Date());
        const lastCycleDate = parse(status.lastCycleDate, config.dateFormat, new Date());
        var dayDiff = differenceInCalendarDays(today, lastCycleDate);
        var days = Math.floor( dayDiff / cycleDays ) * cycleDays;
        nextDate = addDays(lastCycleDate, days);
    } else {
         const currentDate = startOfDay(new Date())
		nextDate = currentDate;
	}
  	return format(nextDate, dateFormat);
}
function updateNextCycleBranches(config, status, currentDateString , cycleDays = 14, branchPrefix = '', dateFormat = "yyyy-MM-dd") 
{
    // Create branch name formatter with prefix support
    const formatBranchName = (date) => {
        
        const dateStr = format(date, dateFormat);
        return config.branchPrefix 
            ? `${config.branchPrefix}/${dateStr}` 
            : dateStr;
    };
    var nextDate;
    
    if(status.lastCycleDate) // string
	{
        var today = parse(currentDateString, dateFormat, new Date());
        const lastCycleDate = parse(status.lastCycleDate, config.dateFormat, new Date());
        var dayDiff = differenceInCalendarDays(today, lastCycleDate);
        var days = Math.floor( dayDiff / cycleDays ) * cycleDays;
        nextDate = addDays(lastCycleDate, days);
    } else {
         const currentDate = startOfDay(new Date())
		nextDate = currentDate;
	}
    // console.log("next date", nextDate);
    var obj = {
        nextCycleDate:format(nextDate, dateFormat),
        newBaseBranch: formatBranchName(nextDate),
        currentBranch: status.base,
        uatSourceBranch: status.uat,  
        proSourceBranch: status.pro,  
    }
   
    if(obj.proSourceBranch != obj.uatSourceBranch )
    {
        logInfo(`set pro to ${obj.uatSourceBranch}`);
        obj.proSourceBranch = obj.uatSourceBranch;
    }
    if(obj.uatSourceBranch != obj.currentBranch)
    {
        // pre branch rebase to status.base
        // set status.pre = status.base
        logInfo(`set uat to ${obj.currentBranch}`)
        obj.uatSourceBranch = obj.currentBranch;
    }
    return obj;
}

// Updated calculateBranchDates to use days instead of weeks
function calculateBranchDates(config, status, dateString , cycleDays = 14, branchPrefix = '', dateFormat = "yyyy-MM-dd") {
    return {
        newBaseBranch: status.base,
        uatSourceBranch: status.uat,  
        proSourceBranch: status.pro,  
    }
	
}

// Check if specified date is a valid execution day based on last cycle from status
function isExecutionDay(dateFormat, currentDate , cycleDays = 14, lastCycleDate = null) {
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
        this.git = simpleGit({
            baseDir: this.gitDir,
            binary: 'git',
            maxConcurrentProcesses: 1
        });
		if(config.debug)
		{
			this.git.outputHandler((command, stdout, stderr) => {
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
        logAction(actionDescription);
        // logInfo(`[GIT DIR] ${this.gitDir}`);
        
        if (this.dryRun) {
            logInfo(`[DRY RUN] Would execute this action`);
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
	async remoteBranchExists(branch)
	{
		const remoteBranches = await this.git.raw([
			'ls-remote', '--heads', this.config.remoteName, branch
		]);
		return remoteBranches.trim() !== '';
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
				var result = await this.git.pull(this.config.remoteName, branch);
				this.evaluateGitResult(result);
            },
            `Pulling from ${this.config.remoteName}/${branch}`,
            critical
        );
    }
    async checkout(branch)
    {
        return await this.git.checkout(branch);
    }

    async createBranch(fromBranch, newBranch, critical = true) {
        if (await this.branchExists(newBranch)) {
            logWarn(`Branch ${newBranch} already exists. Skipping creation.`);
            return { success: true, existed: true };
        }
        return this.execute(
            async () => {
				/*
                await this.git.checkout(fromBranch);
                await this.git.pull(this.config.remoteName, fromBranch);
                await this.git.checkoutBranch(newBranch, fromBranch);
				*/
				await this.git.checkout(fromBranch);
				await this.git.pull(this.config.remoteName, fromBranch);
				
				// 創建新分支
				await this.git.checkoutBranch(newBranch, fromBranch);
				
				// 為新分支創建一個空提交來確保它有獨立的歷史
				// 這樣後續從這個分支創建其他分支就不會有問題
				await this.git.commit('CICD Initial branch commit', ['--allow-empty']);
            },
            `Creating branch ${newBranch} from ${fromBranch}`,
            critical
        );
    }
	async emptyCommit(message)
	{
		// await this.git.commit('CICD Initial branch commit', ['--allow-empty']);
		await this.git.commit(message, ['--allow-empty']);
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
				// console.log("checkout", branch);
				await this.git.checkout(branch);
				if(await this.remoteBranchExists(branch))
				{
					// console.log("pull", this.config.remoteName, branch);
                	await this.git.pull(this.config.remoteName, branch);
				} else {
					logWarn("remote branch not exists", branch);
				}
				// console.log("merge", [fromBranch, ...options]);
                var result = await this.git.merge([fromBranch, ...options]);
				if (result.failed) {
					console.log("Merge failed:", result.failed);
					// Abort the merge if possible
					try {
						await this.git.merge(['--abort']);
						logWarn("Merge aborted.");
					} catch (abortErr) {
						logWarn("Merge abort failed, performing hard reset...");
						await this.git.reset(['--hard']);
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
	async evaluateGitResult(result)
	{
		
        if(!result) return;
        if (
			result.pushed &&
			result.pushed.length > 0 &&
			result.pushed.every(p => p.alreadyUpdated)
		) {
			console.log("Everything up-to-date");
        } else if(result.summary)
        {
            if(result.summary.changes > 0)
            {
                console.log(`changed ${result.summary.changes}`);
            } else if(result.summary.changes == 0)
            {
                console.log("Everything up-to-date");
            }
		} else {
            // console.log("result", result);
			
		}
	}
    async push(branch, force = false, critical = true) {
        const options = force ? ['--force-with-lease'] : [];
        return this.execute(
            async() => {
				const result = await this.git.push(this.config.remoteName, branch, options);
				this.evaluateGitResult(result);
			},
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

    deleteBranch(branch, critical = false) {
        // console.log("deleteBranch", branch);
        return this.execute(
            async()=>{
                // console.log("X1");
                console.log("deleteLocalBranch", branch);
                try{
                    var a = await this.git.deleteLocalBranch(branch);
                    console.log(a);
                    await this.git.push(this.config.remoteName, `:${branch}`);
                } catch(error)
                {
                    console.error("some error", error);
                }
                
			},
            `Deleting branch ${branch} (local and remote)`,
            critical
        );
    }
	
    /*
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
    */
}

// Initialize required date-based branches with strict error handling
async function initializeBranches(git, config, gitDir, dryRun, statusPath, customDate = null) {
    // const git = new GitOperations(config, gitDir, dryRun);
    let status = await loadStatusFile(statusPath);
    const currentDateString = customDate || getTodayString(config.dateFormat);
    var newBaseBranch = `${config.branchPrefix}/` + calculateCycleDateString(config, status, currentDateString, config.dateFormat );
    // const { newBaseBranch, uatSourceBranch, proSourceBranch } = calculateBranchDates(config, status, currentDate, config.cycleDays, config.branchPrefix, config.dateFormat);
	
	if(!status.base) status.base = newBaseBranch;
	if(!status.uat) status.uat = newBaseBranch;
	if(!status.pre) status.pre = newBaseBranch;
	if(!status.pro) status.pro = newBaseBranch;
	
	var items = [
		{
			from:config.baseBranch,
			to:status.base
		},
		{
			from:status.uat,
			to:config.uatBranch
		},
		{
			from:status.pre,
			to:config.preBranch
		},
		{
			from:status.pro,
			to:config.proBranch
		}
	];
	console.log(items);

    console.log(`=== Initializing Required Branches ===`);
    console.log(`Using date: ${currentDateString}`);
    console.log(`Git directory: ${gitDir || process.cwd()}`);
    console.log(`Target branches:`, status);

    
	for (const item of items) {
		console.log("item", item);
		if (!await git.branchExists(item.from)) {
            exitWithError(ERROR_CODES.MISSING_BRANCHES, `Source branch ${item.from} does not exist`);
        }
		if (await git.branchExists(item.to)) {
			logSuccess(`Branch ${item.to} already exists`);
            continue;
        }
		const createResult = await git.createBranch(item.from, item.to);
        
        if (createResult.success && !dryRun) {
			await git.emptyCommit("CICD Initial branch commit");
            await git.push(item.to);
            logSuccess(`Successfully created and pushed ${item.to}`);
        } else if (dryRun) {
            logInfo(`[DRY RUN] Would create ${item.to} from ${item.from}`);
        } else {
            exitWithError(ERROR_CODES.GIT_OPERATION_FAILED, `Failed to create ${item.to}`);
        }
	}
	
    if (statusPath) await saveStatusFile(statusPath, status);
	
	console.log("");
    logOK('=== Initialization Complete ===');
    // process.exit(0);
}

// Verify all required branches exist or exit
async function verifyBranches(git, config, statusPath, gitDir, customDate = null) {
    // const git = new GitOperations(config, gitDir, true);
	let status = await loadStatusFile(statusPath) || {};
    // const currentDate = customDate || new Date();
	const currentDate = customDate || getTodayString(config.dateFormat);
    
    console.log(`=== CI/CD Branch Verification ===`);
    console.log(`Using date: ${currentDate}`);
    console.log(`Repository: ${gitDir || process.cwd()}`);
    
	var branches = calculateBranchDates(config, status, currentDate, config.cycleDays, config.branchPrefix, config.dateFormat);
    const { newBaseBranch, uatSourceBranch, proSourceBranch } =branches;
    const requiredBranches = [
		config.baseBranch, 
		newBaseBranch,

		uatSourceBranch, 
		config.uatBranch, 
		config.preBranch, 

		proSourceBranch,
		config.proBranch
    ];
	// console.log(branches);
    
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
    
    console.log('\n=== Verification Result ===');
    if (missing) {
        logError('Missing required branches - fix before running workflow');
        process.exit(ERROR_CODES.MISSING_BRANCHES);
    } else {
        console.log('✅  All required branches exist');
        // process.exit(0);
    }
}


async function mergeBranches(config, git, currentDate, gitDir, dryRun, status, customDate = null) {
    console.log("\n=== Merge or Rebase Branches ===");
    logInfo(`${currentDate} Merge or Rebase Branches`);
	// logWarn(`${format(currentDate, config.dateFormat)} is not a scheduled execution day.`);
    // logWarn(`${currentDate}  is not a scheduled execution day.`)
	await git.checkout(config.baseBranch);
	await git.pull(config.baseBranch);
    var items = [
        {
			type:"merge",
            name: 'base',
            from:config.baseBranch, // base
            to: status.base // date
        },
        {
			type:"merge",
            name: 'uat',
            from: status.uat, // uat
            to: config.uatBranch // date
        },
        {
			type:"merge",
            name: 'pre',
            from: status.pre, // pre
            to: config.preBranch // date
        },
        {
			type:"merge",
            name: 'pro',
            from: status.pro, // pro
            to: config.proBranch // date
        }
    ];
    for (const item of items) {
        const { name, from, to } = item;
        console.log("\n")
		logInfo(`Process (${name})`);
        // logInfo(`(${from}) → (${to})`);
		if(item.type == "merge")
		{
			const mergeResult = await git.merge(to, from, false, false )
			if (mergeResult.success) {
				console.log(`--- ${name}: Merged (${from}) → (${to})\n`);
			}
		} else if(item.type == "rebase")
		{
			// const rebaseResult = await git.rebase(to, from);
			// console.log("rebase result", rebaseResult);
		}
    }
	
}

function logBranchInfo(status, branches)
{
    const { newBaseBranch, uatSourceBranch, proSourceBranch} = branches;
    console.log(`\n=== Cycle Information ===`);
    // console.log(`Cycle start date: ${cycleMonday}`);
    console.log(`base: (${status.base}) → (${newBaseBranch})`);
    console.log(`UAT: (${status.uat}) → (${uatSourceBranch})`);
    console.log(`PRO: (${status.pro}) → (${proSourceBranch})`);
}
async function createBranches(config, git, currentDateString, gitDir, dryRun, status, customDate = null) {

	await git.checkout(config.baseBranch);
	await git.pull(config.baseBranch);

    const branches = updateNextCycleBranches(config, status, currentDateString, config.cycleDays, config.branchPrefix, config.dateFormat);
	logBranchInfo(status, branches);
    const { newBaseBranch, uatSourceBranch, proSourceBranch} = branches;
    
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
    if(!status.branches) status.branches = [];
    status.branches.push({
        branch: newBaseBranch,
        time:new Date().getTime()
    });
    if (await git.branchExists(newBaseBranch)) {
        logInfo(`Base branch (${newBaseBranch}) already exists. Skipping creation.`);
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
        pro: proSourceBranch,
        lastCycleDate: branches.nextCycleDate
    };
    
    Object.assign(status, newState);

	/*
    if (config.autoRemoveBranches) {
        console.log('\n=== Cleaning Up Old Branches ===');
        await git.removeOldBranches(config.branchPrefix, config.branchRetentionCycles);
    }
	*/
    
    console.log('\n=== Workflow Complete ===');
    logSuccess('All operations completed successfully!');
   
}
// Main workflow execution with strict error handling
async function getTodayString(dateFormat)
{
	const date = new Date();
	return format(date, dateFormat);
}
function logDataObject(name, obj)
{
    console.log(`${name}:`)
    for(var key in obj)
    {
        console.log(`    ${key}: ${obj[key]}`);
    }
}
function logSummary(options, config, status, today, gitDir)
{
    console.log(`=== CI/CD Branch Management Tool ===`);
     // console.log(`Date: ${today}`);
    logDataObject("command line options", options);
    logDataObject("config.json", config);
    logDataObject("status.json", status);
    // console.log(`Git: ${gitDir || process.cwd()}`);
}
async function removeOldBranches(config, status, git){
    
    if(config.autoRemoveBranches && status.branches)
    {
        var days = config.cycleDays * config.branchRetentionCycles;
        var expired = new Date().getTime() - (days * 24 * 60 * 60 * 1000);
        var removingItems = status.branches.filter((item)=>{
            return item.time <= expired;
        });
        if(removingItems.length)
        {
            console.log("");
            logInfo("removing old branches");
            for(var key in removingItems)
            {
                var item = removingItems[key];
                /*
                try {
                    await git.deleteBranch(item.branch, false);
                } catch(error)
                {
                    console.error(`Failed to delete branch ${item.branch}: ${error.message}`);
                }
                */
            }
            logSuccess(`Cleaned up ${removingItems.length} old branches`);
            status.branches = status.branches.filter((item)=>{
                return item.time > expired;
            });
        } else {
            logInfo('No old branches to remove');
        }
    }
}

async function runWorkflow(git, options, config, gitDir, dryRun, statusPath, customDate = null) {
	
    
    const currentDateString = customDate || getTodayString(config.dateFormat);
    let status = await loadStatusFile(statusPath) || {};
    const lastCycleDate = status.lastCycleDate || null;

    logSummary(options, config, status, currentDateString, gitDir);
   
    
    if (isExecutionDay(config.dateFormat, currentDateString, config.cycleDays, lastCycleDate)) {
		await createBranches(config, git, currentDateString, gitDir, dryRun, status, customDate);
        removeOldBranches(config, status, git);
	} else {
		await mergeBranches(config, git, currentDateString, gitDir, dryRun, status, customDate);
    }
    
    await saveStatusFile(statusPath, status);
    console.log('✅  State updated successfully');

	logOK('Exiting gracefully.');
	// process.exit(0);
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
		
		const customDate = await( options.date ? options.date : getTodayString(config.dateFormat) );
        /*
        if (customDate && isNaN(customDate.getTime())) {
            exitWithError(ERROR_CODES.INVALID_DATE, `Invalid date format: ${options.date}. Use YYYY-MM-DD.`);
        }
		*/
		const git = new GitOperations(config, options.gitDir, options.dryRun);
        switch (command) {
            case 'init':
                await initializeBranches(git, config, options.gitDir, options.dryRun, options.status, customDate);
                break;
            case 'verify':
                await verifyBranches(git, config, options.status, options.gitDir, customDate);
                break;
            case 'run':
                await runWorkflow(git, options, config, options.gitDir, options.dryRun, options.status, customDate);
                break;
            default:
                exitWithError(ERROR_CODES.INVALID_COMMAND, `Unknown command: ${command}`);
        }
		await git.checkout(config.baseBranch);
        // removeOldBranches()
    } catch (error) {
		console.error(error.stack);
        exitWithError(ERROR_CODES.GIT_OPERATION_FAILED, `Unexpected error: ${error.message}`);
    }
}

// Execute main function with error handling
main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(ERROR_CODES.GIT_OPERATION_FAILED);
});