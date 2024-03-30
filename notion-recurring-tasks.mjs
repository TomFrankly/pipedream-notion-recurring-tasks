import { Client } from "@notionhq/client";
import Bottleneck from "bottleneck";
import retry from "async-retry";
import { DateTime } from "luxon";

const config = {};

export default defineComponent({
	name: "Notion Recurring Tasks",
	version: "0.1.0",
	key: "notion-recurring-tasks",
	description: "Recurring Tasks for Ultimate Brain",
	type: "action",
	props: {
		notion: {
			type: "app",
			app: "notion",
			description: `This workflow adds automatic, hands-off **recurring tasks** to Notion. \n\n**Need help with this workflow? [Check out the full instructions and FAQ here.](https://thomasjfrank.com/notion-automated-recurring-tasks/)**\n\n## Compatibility\n\nThis workflow **only** works with Notion databases that have my recurring task helper formulas:\n\n* [Ultimate Brain for Notion](https://thomasjfrank.com/brain/) – the **ultimate** second brain template for Notion. A completely productivity system that brings tasks, notes, projects, goals, and useful dashboards into one place. *Use code **LETSGO2023** to get $50 off!*\n* [Ultimate Tasks](https://thomasjfrank.com/templates/task-and-project-notion-template/) – my free task manager template, and the best free task manager for Notion. Includes a robust task and project management system with Today, Next 7 Days, and Inbox views, a Project manager, support for recurring tasks and sub-tasks, and more.\n* * *Ultimate Brain contains an upgraded version of Ultimate Tasks, adding GTD support, better integration with your notes, and useful dashboards (like the My Day dashboard).*\n* [Recurring Tasks](https://thomasfrank.notion.site/Advanced-Recurring-Task-Dates-2022-20c62e1f755742e789bc77f0c76aa454?pvs=4) – *this is a barebones template intended for learning purposes.*\n\n## Instructions\n\n* Connect your Notion account, then choose your Tasks database and your Due date property.\n* Adjust the schedule in the trigger step above if you want. By default, it will run this automation once per hour between 6am and midnight each day.\n* Hit **Deploy** to enable the workflow.\n\n### Automatic Changes\n\nThis automation also automatically changes a couple of small settings in your template:\n\n* The **UTC Offset** formula property's value is updated to reflect the timezone set in your **trigger** step above (and it respects Daylight Savings Time when in effect).\n* The **Type** formula property's value is updated so that it always returns "⏳One-Time". This ensures that recurring tasks will disappear from your task views when you mark them as Done.\n\nFor reference, the original for **Type** is "if(empty(prop("Recur Interval")), "⏳One-Time", "🔄Recurring")" (minus the wrapper quotation marks). You'd only want to revert to this formula if you wanted to stop using this automation and [handle recurring tasks manually](https://thomasjfrank.com/notion-automated-recurring-tasks/#completing-recurring-tasks-manually).\n\n## More Resources\n\n**All My Notion Automations:**\n* [Notion Automations Hub](https://thomasjfrank.com/notion-automations/)\n\n**Want to get notified about updates to this workflow (and about new Notion templates, automations, and tutorials)?**\n* [Join my Notion Tips newsletter](https://thomasjfrank.com/fundamentals/#get-the-newsletter)`,
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
			type: "string",
			default: "{{steps}}",
			label: "Steps (Don't Change This)",
			description: `Fancy, technical things.`,
		}
	},
	async additionalProps() {
		const notion = new Client({
			auth: this.notion.$auth.oauth_access_token,
		});
		const database = await notion.databases.retrieve({
			database_id: this.databaseID,
		});
		const properties = database.properties;

		// Create an array of date props with Due sorted to top
		const datePropsRaw = Object.keys(properties).filter(
			(k) => properties[k].type === "date"
		);
		const dueProp = datePropsRaw.filter((prop) => prop.includes("Due"));
		const nonDueProps = datePropsRaw.filter((prop) => !prop.includes("Due"));
		const dueProps = [...dueProp, ...nonDueProps];

		const formulaPropsRaw = Object.keys(properties).filter(
			(k) => properties[k].type === "formula"
		);
		const nextDueAPIProp = formulaPropsRaw.filter((prop) => prop.includes("Next Due API"));
		const nonNextDueAPIProps = formulaPropsRaw.filter((prop) => !prop.includes("Next Due API"));
		const nextDueAPIProps = [...nextDueAPIProp, ...nonNextDueAPIProps];
		const utcOffsetProp = formulaPropsRaw.filter((prop) => prop.includes("UTC Offset"));
		const nonUtcOffsetProps = formulaPropsRaw.filter((prop) => !prop.includes("UTC Offset"));
		const utcOffsetFormulaProps = [...utcOffsetProp, ...nonUtcOffsetProps];
		const typeProp = formulaPropsRaw.filter((prop) => prop.includes("Type"));
		const nonTypeProps = formulaPropsRaw.filter((prop) => !prop.includes("Type"));
		const typeProps = [...typeProp, ...nonTypeProps];
	
		const checkboxPropsRaw = Object.keys(properties).filter(
			(k) => properties[k].type === "checkbox"
		);
		
		const doneProp = checkboxPropsRaw.filter((prop) => prop.includes("Next Due"));
		const nonDoneProps = checkboxPropsRaw.filter((prop) => !prop.includes("Next Due"));
		const doneCheckboxProps = [...doneProp, ...nonDoneProps];
	
		const props = {
			dueProp: {
				type: "string",
				label: "Due Property",
				description: `Select the **Due** date property for your tasks. If you've renamed this property, choose that one instead.`,
				options: dueProps.map((prop) => ({
					label: prop,
					value: JSON.stringify({ name: prop, id: properties[prop].id }),
				})),
				optional: false,
			},
			nextDueAPIProp: {
				type: "string",
				label: "Next Due API Property",
				description: `Select the **Next Due API** property from your Tasks Database.\n\nThis property contains information about the next due date, formatted specifically for this workflow, and will be used to set the new Due date for the task. If you've renamed this property, choose that one instead.\n\n`,
				options: nextDueAPIProps.map((prop) => ({
					label: prop,
					value: JSON.stringify({ name: prop, id: properties[prop].id }),
				})),
				optional: false,
			},
			utcOffsetProp: {
				type: "string",
				label: "UTC Offset",
				description: `Select the **UTC Offset** property from your Tasks Database.\n\nThis property contains information about your time zone, and it's updated automatically based on the time zone you chose for this Pipedream workflow. If you've renamed this property, choose that one instead.\n\n`,
				options: utcOffsetFormulaProps.map((prop) => ({
					label: prop,
					value: JSON.stringify({ name: prop, id: properties[prop].id }),
				})),
				optional: false,
			},
			doneProp: {
				type: "string",
				label: "Done",
				description: `Select the **Done** property from your Tasks Database.\n\nThis property marks whether your task is currently finished. If you've renamed this property, choose that one instead.\n\n`,
				options: doneCheckboxProps.map((prop) => ({
					label: prop,
					value: JSON.stringify({ name: prop, id: properties[prop].id }),
				})),
				optional: false,
			},
			typeProp: {
				type: "string",
				label: "Type",
				description: `Select the **Type** property from your Tasks Database.\n\nThis property marks whether a task is recurring for manual recurring tasks, but this automation will automatically set it up for use with automated recurring tasks. If you've renamed this property, choose that one instead.\n\n`,
				options: typeProps.map((prop) => ({
					label: prop,
					value: JSON.stringify({ name: prop, id: properties[prop].id }),
				})),
				optional: false,
			},
		};
		
		return props;
	},
	methods: {
		async setUTCOffset(notion, timestamp, limiter) {
			// Set the date and get the UTC offset
			const date = DateTime.fromISO(timestamp, {setZone: true});
			console.log(date)
			const offsetNum = date.offset / 60;
			const offset = offsetNum.toString()

			console.log(`User-set workflow UTC offset is ${offset}.`)

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
											}
									},
									[config.type.name]: {
										formula: {
											expression: `if(empty(prop("Recur Interval")), "⏳One-Time", "⏳One-Time")`
										}
									}
								}
							})
						);

						return resp
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
				const startDate = JSON.parse(nextDueAPI)['start'];
				const endDate = (JSON.parse(nextDueAPI)['end'] == startDate) ? null : JSON.parse(nextDueAPI)['end'];
				
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
		config.type = JSON.parse(this.typeProp);
		
		console.log(config);

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
		const utc_offset = await this.setUTCOffset(notion, this.steps.trigger.event.timezone_configured.iso8601.timestamp, limiter)

		console.log("Updated UTC offset.")
		console.log(utc_offset)

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

		return updatedTasks;
	},
});