/**
 * To Do
 * - Update the configs with up-to-date database schema pulled from Notion
 * - Create reusable methods for API calls, scheduling, retrying, and error handling
 * - Export a report about processed tasks; user can add further steps to email this to themselves, send a Slack message, etc
 */

import { Client } from "@notionhq/client";
import Bottleneck from "bottleneck";
import retry from "async-retry";
import { DateTime } from "luxon";

const config = {};

export default {
	name: "Beta Notion Recurring Tasks",
	description: "Recurring Tasks for Ultimate Brain",
	key: "notion-recurring-tasks-beta",
	version: "0.1.56",
	type: "action",
	props: {
		notion: {
			type: "app",
			app: "notion",
			description: `This workflow adds automatic, hands-off **recurring tasks** to Notion. \n\n**Need help with this workflow? [Check out the full instructions and FAQ here.](https://thomasjfrank.com/notion-automated-recurring-tasks/)**\n\n## Compatibility\n\nThis workflow **only** works with Notion databases that have my recurring task helper formulas:\n\n* [Ultimate Brain for Notion](https://thomasjfrank.com/brain/) – the **ultimate** second brain template for Notion. A completely productivity system that brings tasks, notes, projects, goals, and useful dashboards into one place. *Use code **LETSGO2024** to get $50 off!*\n* [Ultimate Tasks](https://thomasjfrank.com/templates/task-and-project-notion-template/) – my free task manager template, and the best free task manager for Notion. Includes a robust task and project management system with Today, Next 7 Days, and Inbox views, a Project manager, support for recurring tasks and sub-tasks, and more.\n* * *Ultimate Brain contains an upgraded version of Ultimate Tasks, adding GTD support, better integration with your notes, and useful dashboards (like the My Day dashboard).*\n* [Recurring Tasks](https://thomasfrank.notion.site/Advanced-Recurring-Task-Dates-2022-20c62e1f755742e789bc77f0c76aa454?pvs=4) – *this is a barebones template intended for learning purposes.*\n\n## Instructions\n\n* Connect your Notion account, then choose your Tasks database and your Due date property.\n* Adjust the schedule in the trigger step above if you want. By default, it will run this automation once per hour between 6am and midnight each day.\n* Hit **Deploy** to enable the workflow.\n\n### Automatic Changes\n\nThis automation also automatically changes a couple of small settings in your template:\n\n* The **UTC Offset** formula property's value is updated to reflect the timezone set in your **trigger** step above (and it respects Daylight Savings Time when in effect).\n* The **Type** formula property's value is updated so that it always returns "⏳One-Time". This ensures that recurring tasks will disappear from your task views when you mark them as Done.\n\nFor reference, the original for **Type** is "if(empty(prop("Recur Interval")), "⏳One-Time", "🔄Recurring")" (minus the wrapper quotation marks). You'd only want to revert to this formula if you wanted to stop using this automation and [handle recurring tasks manually](https://thomasjfrank.com/notion-automated-recurring-tasks/#completing-recurring-tasks-manually).\n\n## More Resources\n\n**All My Notion Automations:**\n* [Notion Automations Hub](https://thomasjfrank.com/notion-automations/)\n\n**Want to get notified about updates to this workflow (and about new Notion templates, automations, and tutorials)?**\n* [Join my Notion Tips newsletter](https://thomasjfrank.com/fundamentals/#get-the-newsletter)`,
		},
		databaseID: {
			type: "string",
			label: "Target Database",
			description: `Select your Tasks database. If you're using Ultimate Brain, the default database name will be **All Tasks [UB]** (unless you have changed it). If you're using Ultimate Tasks, the default database name will be **All Tasks**.`,
			async options({ query, prevContext }) {
				const notion = new Client({
					auth: this.notion.$auth.oauth_access_token,
				});
				let start_cursor = prevContext?.cursor;
				const response = await notion.search({
					...(query ? { query } : {}),
					...(start_cursor ? { start_cursor } : {}),
					page_size: 50,
					filter: {
						value: "database",
						property: "object",
					},
					sorts: [
						{
							direction: "descending",
							property: "last_edited_time",
						},
					],
				});
				let allTasksDbs = response.results.filter((db) =>
					db.title?.[0]?.plain_text.includes("All Tasks")
				);
				let nonTaskDbs = response.results.filter(
					(db) => !db.title?.[0]?.plain_text.includes("All Tasks")
				);
				let sortedDbs = [...allTasksDbs, ...nonTaskDbs];
				const UTregex = /All Tasks/;
				const UTLabel = " – (used for Ultimate Tasks)";
				const UBregex = /All Tasks \[\w*\]/;
				const UBLabel = " – (used for Ultimate Brain)";
				const options = sortedDbs.map((db) => ({
					label: UBregex.test(db.title?.[0]?.plain_text)
						? db.title?.[0]?.plain_text + UBLabel
						: UTregex.test(db.title?.[0]?.plain_text)
						? db.title?.[0]?.plain_text + UTLabel
						: db.title?.[0]?.plain_text,
					value: db.id,
				}));
				return {
					context: {
						cursor: response.next_cursor,
					},
					options,
				};
			},
			reloadProps: true,
		},
		steps: {
			type: "object",
			label: "Previous Step Data (Set by Default)",
			description: `This property simply passes data from the previous step(s) in the workflow to this step. It should be pre-filled with a default value of **{{steps}}**, and you shouldn't need to change it.`,
		},
	},
	async additionalProps() {
		const notion = new Client({
			auth: this.notion.$auth.oauth_access_token,
		});
		const database = await notion.databases.retrieve({
			database_id: this.databaseID,
		});

		const properties = database.properties;

		const sortByPropName = (props, nameIncludes) =>
			props.sort((a, b) => {
				const aIndex = nameIncludes.findIndex((name) => a.includes(name));
				const bIndex = nameIncludes.findIndex((name) => b.includes(name));

				if (aIndex !== -1 && bIndex !== -1) {
					if (aIndex < bIndex) return -1;
					if (aIndex > bIndex) return 1;
				}

				if (aIndex !== -1) return -1;
				if (bIndex !== -1) return 1;

				return 0;
			});

		const getPropsWithTypes = (types) =>
			Object.keys(properties).filter((k) => types.includes(properties[k].type));

		const dueProps = sortByPropName(getPropsWithTypes(["date"]), ["Due"]);
		const nextDueAPIProps = sortByPropName(getPropsWithTypes(["formula"]), [
			"Next Due API",
		]);
		const utcOffsetFormulaProps = sortByPropName(getPropsWithTypes(["formula"]), [
			"UTC Offset",
		]);
		const typeProps = sortByPropName(getPropsWithTypes(["formula"]), ["Type"]);
		const doneCheckboxProps = sortByPropName(
			getPropsWithTypes(["checkbox", "status"]),
			["Status", "Kanban Status", "Done"]
		);

		const props = {
			dueProp: {
				type: "string",
				label: "Due Property",
				description: `Select the **Due** date property for your tasks. If you've renamed this property, choose that one instead.`,
				options: dueProps.map((prop) => ({
					label: `${prop} - (Type: ${properties[prop].type})`,
					value: JSON.stringify({
						name: prop,
						id: properties[prop].id,
						type: properties[prop].type,
					}),
				})),
				optional: false,
			},
			doneProp: {
				type: "string",
				label: "Task Status Property",
				description: `Select the primary property you use for tracking the status of your tasks. This property should be a **Status** or **Checkbox** property. If you have multiple properties that track task status, choose the one you actually use to track your recurring tasks.\n\n`,
				options: doneCheckboxProps.map((prop) => ({
					label: `${prop} - (Type: ${properties[prop].type})`,
					value: JSON.stringify({
						name: prop,
						id: properties[prop].id,
						type: properties[prop].type,
					}),
				})),
				optional: false,
				reloadProps: true,
			},
			...(this.doneProp &&
				JSON.parse(this.doneProp).type === "status" && {
					donePropStatusNotStarted: {
						type: "string",
						label: `"Not Started" Task Status Option`,
						description: `Select the option from your chosen Status property that represents a value of "Not Started".\n\nThis is the option that your tasks will be set back to when this automation runs and processes you completed recurring tasks. This option is called **Not Started** by default, or **To Do** in Ultimate Brain; if you've renamed this option, choose that one instead.\n\n`,
						options: properties[JSON.parse(this.doneProp).name].status.options.map((option) => ({
							label: option.name,
							value: JSON.stringify(option),
						})),
						optional: false,
					},
					donePropStatusCompleted: {
						type: "string",
						label: `"Done" Task Status Option`,
						description: `Select the option from your chosen Status property that represents a value of "Done".\n\nThis is the option that you'll set your tasks to in order to *complete* them. This workflow will only process tasks that are currently set to this option.\n\nThis option is called **Done** by default; if you've renamed this option, choose that one instead.\n\n`,
						options: properties[JSON.parse(this.doneProp).name].status.options.map((option) => ({
							label: option.name,
							value: JSON.stringify(option),
						})),
						optional: false,
					},
				}
			),
			nextDueAPIProp: {
				type: "string",
				label: "Next Due API Property",
				description: `Select the **Next Due API** property from your Tasks Database.\n\nThis property contains information about the next due date, formatted specifically for this workflow, and will be used to set the new Due date for the task. If you've renamed this property, choose that one instead.\n\n`,
				options: nextDueAPIProps.map((prop) => ({
					label: `${prop} - (Type: ${properties[prop].type})`,
					value: JSON.stringify({
						name: prop,
						id: properties[prop].id,
						type: properties[prop].type,
					}),
				})),
				optional: false,
			},
			utcOffsetProp: {
				type: "string",
				label: "UTC Offset",
				description: `Select the **UTC Offset** property from your Tasks Database.\n\nThis property contains information about your time zone, and it's updated automatically based on the time zone you chose for this Pipedream workflow. If you've renamed this property, choose that one instead.\n\n`,
				options: utcOffsetFormulaProps.map((prop) => ({
					label: `${prop} - (Type: ${properties[prop].type})`,
					value: JSON.stringify({
						name: prop,
						id: properties[prop].id,
						type: properties[prop].type,
					}),
				})),
				optional: false,
			},
			typeProp: {
				type: "string",
				label: "Type",
				description: `Select the **Type** property from your Tasks Database.\n\nThis property marks whether a task is recurring for manual recurring tasks, but this automation will automatically set it up for use with automated recurring tasks. If you've renamed this property, choose that one instead.\n\n`,
				options: typeProps.map((prop) => ({
					label: `${prop} - (Type: ${properties[prop].type})`,
					value: JSON.stringify({
						name: prop,
						id: properties[prop].id,
						type: properties[prop].type,
					}),
				})),
				optional: false,
			},
			...(this.doneProp && {
				secondaryDoneProp: {
					type: "string",
					label: "(Optional) Secondary Task Status Property",
					description: `If you have another property used for tracking task status that you'd like this automation to check and reset, choose it here\n\nMost users do not need to set this property. It exists only for users who are using versions of Ultimate Brain or Ultimate Tasks that use both the **Done** (checkbox) and **Kanban Status** (status) properties to track task status. \n\nEven if your template has both of these, you'll only need to set this property if you're using both properties to track recurring tasks.`,
					options: doneCheckboxProps.map((prop) => ({
						label: `${prop} - (Type: ${properties[prop].type})`,
						value: JSON.stringify({
							name: prop,
							id: properties[prop].id,
							type: properties[prop].type,
						}),
					})),
					optional: true,
					reloadProps: true,
				}
			}),
			...(this.secondaryDoneProp &&
				JSON.parse(this.secondaryDoneProp).type === "status" && {
					secondaryDonePropStatusNotStarted: {
						type: "string",
						label: `"Not Started" Secondary Task Status Option`,
						description: `Select the option from your chosen Status property that represents a value of "Not Started".\n\nThis is the option that your tasks will be set back to when this automation runs and processes you completed recurring tasks. This option is called **Not Started** by default, or **To Do** in Ultimate Brain; if you've renamed this option, choose that one instead.\n\n`,
						options: properties[JSON.parse(this.secondaryDoneProp).name].status.options.map((option) => ({
							label: option.name,
							value: JSON.stringify(option),
						})),
						optional: false,
					},
					secondaryDonePropStatusCompleted: {
						type: "string",
						label: `"Done" Secondary Task Status Option`,
						description: `Select the option from your chosen Status property that represents a value of "Done".\n\nThis is the option that you'll set your tasks to in order to *complete* them. This workflow will only process tasks that are currently set to this option.\n\nThis option is called **Done** by default; if you've renamed this option, choose that one instead.\n\n`,
						options: properties[JSON.parse(this.secondaryDoneProp).name].status.options.map((option) => ({
							label: option.name,
							value: JSON.stringify(option),
						})),
						optional: false,
					},
				}
			),
		};

		return props;
	},
	methods: {
		async setUTCOffset(notion, timestamp, limiter) {
			// Set the date and get the UTC offset
			const date = DateTime.fromISO(timestamp, { setZone: true });
			console.log(date);
			const offsetNum = date.offset / 60;
			const offset = offsetNum.toString();

			console.log(`User-set workflow UTC offset is ${offset}.`);

			// Handle 429 errors
			limiter.on("error", (error) => {
				const isRateLimitError = error.statusCode === 429;
				if (isRateLimitError) {
					console.log(
						`Job ${jobInfo.options.id} failed due to rate limit: ${error}`
					);
					const waitTime = error.headers["retry-after"]
						? parseInt(error.headers["retry-after"], 10)
						: 0.4;
					console.log(`Retrying after ${waitTime} seconds...`);

					return waitTime * 1000;
				}
				console.log(`Job ${jobInfo.options.id} failed: ${error}`);

				// Don't retry via limiter if it's not a 429
				return;
			});

			return await retry(
				async (bail) => {
					try {
						const resp = await limiter.schedule(() =>
							notion.databases.update({
								database_id: this.databaseID,
								properties: {
									[config.utcOffset.name]: {
										formula: {
											expression: `${offset}`,
										},
									},
									[config.type.name]: {
										formula: {
											expression: `if(empty(prop("Recur Interval")), "⏳One-Time", "⏳One-Time")`,
										},
									},
								},
							})
						);

						return resp;
					} catch (error) {
						if (400 <= error.status && error.status <= 409) {
							// Don't retry for errors 400-409
							bail(error);
							return;
						}
						if (
							error.status === 500 ||
							error.status === 503 ||
							error.status === 504
						) {
							// Retry on 500, 503, and 504
							throw error;
						}
						// Don't retry for other errors
						bail(error);
					}
				},
				{
					retries: 3,
					onRetry: (error, attempt) => {
						console.log(
							`Attempt ${attempt} failed with error: ${error}. Retrying...`
						);
					},
				}
			);
		},
		async queryNotion(notion, limiter) {
			// Pagination variables
			let hasMore = undefined;
			let token = undefined;

			// Handle 429 errors
			limiter.on("error", (error) => {
				const isRateLimitError = error.statusCode === 429;
				if (isRateLimitError) {
					console.log(
						`Job ${jobInfo.options.id} failed due to rate limit: ${error}`
					);
					const waitTime = error.headers["retry-after"]
						? parseInt(error.headers["retry-after"], 10)
						: 0.4;
					console.log(`Retrying after ${waitTime} seconds...`);

					return waitTime * 1000;
				}
				console.log(`Job ${jobInfo.options.id} failed: ${error}`);

				// Don't retry via limiter if it's not a 429
				return;
			});
			// Initial array for arrays of User or Project objects
			let rows = [];
			// Query the Notion API until hasMore == false. Add all results to the rows array
			while (hasMore == undefined || hasMore == true) {
				await retry(
					async (bail) => {
						try {
							const params = {
								database_id: this.databaseID,
								filter_properties: [config.due.id, config.nextDueAPI.id],
								page_size: 100,
								start_cursor: token,
								filter: {
									and: [
										{
											property: config.done.name,
											checkbox: {
												equals: true,
											},
										},
										{
											property: config.nextDueAPI.name,
											formula: {
												string: {
													does_not_equal: "∅",
												},
											},
										},
									],
								},
							};

							const resp = await limiter.schedule(() =>
								notion.databases.query(params)
							);
							rows.push(resp.results);
							hasMore = resp.has_more;
							if (resp.next_cursor) {
								token = resp.next_cursor;
							}
						} catch (error) {
							if (400 <= error.status && error.status <= 409) {
								// Don't retry for errors 400-409
								bail(error);
								return;
							}
							if (
								error.status === 500 ||
								error.status === 503 ||
								error.status === 504
							) {
								// Retry on 500, 503, and 504
								throw error;
							}
							// Don't retry for other errors
							bail(error);
						}
					},
					{
						retries: 3,
						onRetry: (error, attempt) => {
							console.log(`Attempt ${attempt} failed. Retrying...`);
						},
					}
				);
			}

			return rows.flat();
		},
		async updatePages(notion, pages, limiter) {
			// Handle 429 errors
			limiter.on("error", (error) => {
				const isRateLimitError = error.statusCode === 429;
				if (isRateLimitError) {
					console.log(
						`Job ${jobInfo.options.id} failed due to rate limit: ${error}`
					);
					const waitTime = error.headers["retry-after"]
						? parseInt(error.headers["retry-after"], 10)
						: 0.4;
					console.log(`Retrying after ${waitTime} seconds...`);
					return waitTime * 1000;
				}
				console.log(`Job ${jobInfo.options.id} failed: ${error}`);

				// Don't retry via limiter if it's not a 429
				return;
			});

			const resultsArray = [];

			for (let page of pages) {
				console.log(`Processing task at: ${page.url}`);

				console.log("Properties:");
				console.log(page.properties);

				// Get the current Due date
				const due = page.properties[config.due.name].date.start;
				const nextDueAPI = page.properties[config.nextDueAPI.name].formula.string;
				const startDate = JSON.parse(nextDueAPI)["start"];
				const endDate =
					JSON.parse(nextDueAPI)["end"] == startDate
						? null
						: JSON.parse(nextDueAPI)["end"];

				console.log(`Current Due value: ${due}`);
				console.log(`Current Next Due API value: ${nextDueAPI}`);

				await retry(
					async (bail) => {
						try {
							const resp = await limiter.schedule(() =>
								notion.pages.update({
									page_id: page.id,
									properties: {
										[config.done.name]: {
											checkbox: false,
										},
										[config.due.name]: {
											date: {
												start: startDate,
												end: endDate,
											},
										},
									},
								})
							);

							resultsArray.push(resp);
						} catch (error) {
							if (400 <= error.status && error.status <= 409) {
								// Don't retry for errors 400-409
								bail(error);
								return;
							}
							if (
								error.status === 500 ||
								error.status === 503 ||
								error.status === 504
							) {
								// Retry on 500, 503, and 504
								throw error;
							}
							// Don't retry for other errors
							bail(error);
						}
					},
					{
						retries: 3,
						onRetry: (error, attempt) => {
							console.log(
								`Attempt ${attempt} failed with error: ${error}. Retrying...`
							);
						},
					}
				);
			}

			return resultsArray;
		},
	},
	async run({ $ }) {
		// Set the configs
		config.due = JSON.parse(this.dueProp);
		config.nextDueAPI = JSON.parse(this.nextDueAPIProp);
		config.utcOffset = JSON.parse(this.utcOffsetProp);
		config.done = JSON.parse(this.doneProp);
		if (this.donePropStatusNotStarted) {
			config.doneStatusNotStarted = JSON.parse(this.donePropStatusNotStarted);
		}
		if (this.donePropStatusCompleted) {
			config.doneStatusCompleted = JSON.parse(this.donePropStatusCompleted);
		}
		config.type = JSON.parse(this.typeProp);
		if (this.secondaryDoneProp) {
			config.secondaryDone = JSON.parse(this.secondaryDoneProp);
		}
		if (this.secondaryDonePropStatusNotStarted) {
			config.secondaryDoneStatusNotStarted = JSON.parse(
				this.secondaryDonePropStatusNotStarted
			);
		}
		if (this.secondaryDonePropStatusCompleted) {
			config.secondaryDoneStatusCompleted = JSON.parse(
				this.secondaryDonePropStatusCompleted
			);
		}

		console.log(`Configs:`);
		console.dir(config)

		/*

		// Query the chosen tasks database for completed recurring tasks
		const notion = new Client({
			auth: this.notion.$auth.oauth_access_token,
		});

		// Set up our Bottleneck limiter
		const limiter = new Bottleneck({
			minTime: 333,
			maxConcurrent: 1,
		});

		// Update the user's UTC Offset
		const utc_offset = await this.setUTCOffset(
			notion,
			this.steps.trigger.event.timezone_configured.iso8601.timestamp,
			limiter
		);

		console.log("Updated UTC offset.");
		console.log(utc_offset);

		// Query Notion for completed recurring tasks
		const completedRecurringTasks = await this.queryNotion(notion, limiter);

		console.log("Completed Recurring Tasks:");
		console.log(completedRecurringTasks);

		// Update the recurring tasks
		const updatedTasks = await this.updatePages(
			notion,
			completedRecurringTasks,
			limiter
		);

		return updatedTasks; */
	},
};
