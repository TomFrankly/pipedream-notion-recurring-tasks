/**
 * To Do
 * X Update the configs with up-to-date database schema pulled from Notion
 * X Write method to handle status updates
 * X Handle secondary status updates
 * X Add robust logging
 * - Create reusable methods for API calls, scheduling, retrying, and error handling
 * X Export a report about processed tasks; user can add further steps to email this to themselves, send a Slack message, etc
 * - Filter user choices further
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
	version: "0.1.63",
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
						options: properties[JSON.parse(this.doneProp).name].status.options.map(
							(option) => ({
								label: option.name,
								value: JSON.stringify(option),
							})
						),
						optional: false,
					},
					donePropStatusCompleted: {
						type: "string",
						label: `"Done" Task Status Option`,
						description: `Select the option from your chosen Status property that represents a value of "Done".\n\nThis is the option that you'll set your tasks to in order to *complete* them. This workflow will only process tasks that are currently set to this option.\n\nThis option is called **Done** by default; if you've renamed this option, choose that one instead.\n\n`,
						options: properties[JSON.parse(this.doneProp).name].status.options.map(
							(option) => ({
								label: option.name,
								value: JSON.stringify(option),
							})
						),
						optional: false,
					},
				}),
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
				},
			}),
			...(this.secondaryDoneProp &&
				JSON.parse(this.secondaryDoneProp).type === "status" && {
					secondaryDonePropStatusNotStarted: {
						type: "string",
						label: `"Not Started" Secondary Task Status Option`,
						description: `Select the option from your chosen Status property that represents a value of "Not Started".\n\nThis is the option that your tasks will be set back to when this automation runs and processes you completed recurring tasks. This option is called **Not Started** by default, or **To Do** in Ultimate Brain; if you've renamed this option, choose that one instead.\n\n`,
						options: properties[
							JSON.parse(this.secondaryDoneProp).name
						].status.options.map((option) => ({
							label: option.name,
							value: JSON.stringify(option),
						})),
						optional: false,
					},
					secondaryDonePropStatusCompleted: {
						type: "string",
						label: `"Done" Secondary Task Status Option`,
						description: `Select the option from your chosen Status property that represents a value of "Done".\n\nThis is the option that you'll set your tasks to in order to *complete* them. This workflow will only process tasks that are currently set to this option.\n\nThis option is called **Done** by default; if you've renamed this option, choose that one instead.\n\n`,
						options: properties[
							JSON.parse(this.secondaryDoneProp).name
						].status.options.map((option) => ({
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
							console.log("Error updating UTC Offset:", error);
							bail(error);
						} else {
							console.log("Error updating UTC Offset:", error);
							throw error;
						}
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
		async updateSchema(notion) {
			// Get the database schema
			const response = await retry(
				async (bail) => {
					try {
						const resp = await notion.databases.retrieve({
							database_id: this.databaseID,
						});

						return resp;
					} catch (error) {
						if (400 <= error.status && error.status <= 409) {
							console.log("Error retrieving database:", error);
							bail(error);
						} else {
							console.log("Error retrieving database:", error);
							throw error;
						}
					}
				},
				{
					retries: 5,
					onRetry: (error) =>
						console.log("Retrying Notion database retrieval:", error),
				}
			);

			// Ensure the status option names are up-to-date
			if (config.done.type === "status") {
				console.log(`Current Done Status Options: ${config.done.not_started.name} (for Not Started) and ${config.done.completed.name} (for Done). Checking the database for the most up-to-date status option names...`);
				const statusProp = response.properties[config.done.name];

				console.log(`Done Status Property from datbase:`);
				console.dir(statusProp);

				config.done.not_started.name = statusProp.status.options.find(
					(option) => option.id === config.done.not_started.id
				).name;

				config.done.completed.name = statusProp.status.options.find(
					(option) => option.id === config.done.completed.id
				).name;

				console.log(
					`Updated Done Status Options: ${config.done.not_started.name} (for Not Started) and ${config.done.completed.name} (for Done).`
				);
			}

			if (config.secondary_done && config.secondary_done.type === "status") {
				console.log(`Current Secondary Done Status Options: ${config.secondary_done.not_started.name} (for Not Started) and ${config.secondary_done.completed.name} (for Done).
			
			Checking the database for the most up-to-date status option names...`);
				const statusProp = response.properties[config.secondary_done.name];

				console.log(`Secondary Done Status Property from datbase:`);
				console.dir(statusProp);

				config.secondary_done.not_started.name = statusProp.status.options.find(
					(option) => option.id === config.secondary_done.not_started.id
				).name;

				config.secondary_done.completed.name = statusProp.status.options.find(
					(option) => option.id === config.secondary_done.completed.id
				).name;

				console.log(
					`Updated Secondary Done Status Options: ${config.secondary_done.not_started.name} (for Not Started) and ${config.secondary_done.completed.name} (for Done).`
				);
			}

			// Logging the config once again
			console.log(`Schema update successful. Final Configs:`);
			console.dir(config);
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
				// Define the "done" filter parameter based on the config
				let doneFilter = {}
				if (config.done.type === "checkbox") {
					doneFilter = {
						property: config.done.name,
						checkbox: {
							equals: true,
						},
					};
				} else if (config.done.type === "status") {
					doneFilter = {
						property: config.done.name,
						status: {
							equals: config.done.completed.name,
						},
					};
				}

				console.log(`Done filter:`);
				console.dir(doneFilter);

				// Define the "secondary done" filter parameter based on the config
				let secondaryDoneFilter = {};
				if (config.secondary_done) {
					if (config.secondary_done.type === "checkbox") {
						secondaryDoneFilter = {
							property: config.secondary_done.name,
							checkbox: {
								equals: true,
							},
						};
					} else if (config.secondary_done.type === "status") {
						secondaryDoneFilter = {
							property: config.secondary_done.name,
							status: {
								equals: config.secondary_done.completed.name,
							},
						};
					}

					console.log(`Secondary Done filter:`);
					console.dir(secondaryDoneFilter);
				}

				// Create the "OR" array for "done" and "secondary done" filters
				let orArray = [doneFilter];
				if (config.secondary_done) {
					orArray.push(secondaryDoneFilter);
				}

				console.log(`OR array:`);
				console.dir(orArray);
				
				const params = {
					database_id: this.databaseID,
					//filter_properties: [config.due.id, config.nextDueAPI.id],
					page_size: 100,
					start_cursor: token,
					filter: {
						and: [
							{
								or: orArray,
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

				console.log(`Querying Notion database with params:`);
				console.dir(params);

				await retry(
					async (bail) => {
						try {
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
								console.log("Error querying Notion database:", error);
								bail(error);
							} else {
								console.log("Error querying Notion database:", error);
								throw error;
							}
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

				// Define the "Done" type and values
				let doneType = config.done.type;
				console.log(`Done type: ${doneType}`);
				let doneObject = {};
				if (doneType === "checkbox") {
					doneObject = {
						checkbox: false,
					};
				} else if (doneType === "status") {
					doneObject = {
						status: {
							name: config.done.not_started.name,
						},
					};
				}

				console.log(`Done object:`);
				console.dir(doneObject);

				// Set up "Secondary Done" type and values if needed
				let secondaryDoneObject = {};
				if (config.secondary_done) {
					let secondaryDoneType = config.secondary_done.type;
					console.log(`Secondary Done type: ${secondaryDoneType}`);
					if (secondaryDoneType === "checkbox") {
						secondaryDoneObject = {
							[config.secondary_done.name]: {
								checkbox: false,
							},
						};
					} else if (secondaryDoneType === "status") {
						secondaryDoneObject = {
							[config.secondary_done.name]: {
								status: {
									name: config.secondary_done.not_started.name,
								},
							},
						};
					}
				}

				const params = {
					page_id: page.id,
					properties: {
						[config.done.name]: doneObject,
						[config.due.name]: {
							date: {
								start: startDate,
								end: endDate,
							},
						},
						...(config.secondary_done && secondaryDoneObject),
					},
				}

				console.log(`Update params:`);
				console.dir(params);

				await retry(
					async (bail) => {
						try {
							const resp = await limiter.schedule(() =>
								notion.pages.update(params)
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
		console.log(`Setting up configs...`);
		config.due = JSON.parse(this.dueProp);
		config.nextDueAPI = JSON.parse(this.nextDueAPIProp);
		config.utcOffset = JSON.parse(this.utcOffsetProp);
		config.done = JSON.parse(this.doneProp);
		if (this.donePropStatusNotStarted) {
			config.done.not_started = JSON.parse(this.donePropStatusNotStarted);
		}
		if (this.donePropStatusCompleted) {
			config.done.completed = JSON.parse(this.donePropStatusCompleted);
		}
		config.type = JSON.parse(this.typeProp);
		if (this.secondaryDoneProp) {
			config.secondary_done = JSON.parse(this.secondaryDoneProp);
			if (this.secondaryDonePropStatusNotStarted) {
				config.secondary_done.not_started = JSON.parse(
					this.secondaryDonePropStatusNotStarted
				);
			}
			if (this.secondaryDonePropStatusCompleted) {
				config.secondary_done.completed = JSON.parse(
					this.secondaryDonePropStatusCompleted
				);
			}
		}

		console.log(`Initial configs, based on user's configured properties here in Pipedream:`);
		console.dir(config);

		// Set up our Notion client
		console.log(`Setting up Notion client...`)
		const notion = new Client({
			auth: this.notion.$auth.oauth_access_token,
		});

		// Update the schema
		console.log(`Updating schema for status-type props, if set...`);
		await this.updateSchema(notion);

		// Set up our Bottleneck limiter
		const limiter = new Bottleneck({
			minTime: 333,
			maxConcurrent: 1,
		});

		// Update the user's UTC Offset
		console.log(`Updating UTC Offset. This workflow sets your UTC Offset property in Notion to match the configured timezone in the Trigger step. If you need to change it, you can do so in the Trigger step's Configure tab -> Schedule menu -> Timezone field.`);
		const utc_offset = await this.setUTCOffset(
			notion,
			this.steps.trigger.event.timezone_configured.iso8601.timestamp,
			limiter
		);

		console.log("Updated UTC offset.");
		console.log(utc_offset);

		// Query Notion for completed recurring tasks
		console.log(`Querying Notion for completed recurring tasks.`)
		if (config.secondary_done) {
			console.log(`Secondary Task Status property is set. Checking for tasks that are marked as Done in either the main or secondary Task Status properties.`);
		} else {
			console.log(`Secondary Task Status property is not set. Checking for tasks that are marked as Done in the main Task Status property.`);
		}
		const completedRecurringTasks = await this.queryNotion(notion, limiter);

		console.log(`Found ${completedRecurringTasks.length} Completed Recurring Tasks:`);
		console.log(completedRecurringTasks);

		// Update the recurring tasks
		console.log(`Updating recurring tasks in Notion...`);
		const updatedTasks = await this.updatePages(
			notion,
			completedRecurringTasks,
			limiter
		);

		console.log("Successfully updated tasks.");
		const exportedData = {
			completedRecurringTasks: completedRecurringTasks,
			updatedTasks: updatedTasks,
		}
		return exportedData;
	},
};
