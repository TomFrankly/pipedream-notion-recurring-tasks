import { Client } from "@notionhq/client";
import Bottleneck from "bottleneck";
import retry from "async-retry";
import { DateTime } from "luxon";

const config = {};

export default {
	name: "Notion Recurring Tasks",
	description: "Recurring Tasks for Ultimate Brain",
	key: "notion-recurring-tasks",
	version: "0.1.79",
	type: "action",
	props: {
		instructions: {
			type: "alert",
			alertType: "info",
			content: `This workflow adds automatic, hands-off **recurring tasks** to Notion. \n\n**Need help with this workflow? [Check out the full instructions and FAQ here.](https://thomasjfrank.com/notion-automated-recurring-tasks/)**\n\nIssues and bugs can be reported at this automation's [Github repo](https://github.com/TomFrankly/pipedream-notion-recurring-tasks/issues).\n\n## Compatibility\n\nThis workflow **only** works with Notion databases that have my recurring task helper formulas:\n\n* [Ultimate Brain for Notion](https://thomasjfrank.com/brain/) – the **ultimate** second brain template for Notion. A completely productivity system that brings tasks, notes, projects, goals, and useful dashboards into one place. *Use code **LETSGO2024** to get $50 off!*\n* [Ultimate Tasks](https://thomasjfrank.com/templates/task-and-project-notion-template/) – my free task manager template, and the best free task manager for Notion.\n* * *Ultimate Brain contains an upgraded version of Ultimate Tasks, adding GTD support, better integration with your notes, and useful dashboards (like the My Day dashboard).*\n* [Recurring Tasks](https://thomasfrank.notion.site/Advanced-Recurring-Task-Dates-2022-20c62e1f755742e789bc77f0c76aa454?pvs=4) – *this is a barebones template intended for learning purposes.*\n\n## Instructions\n\n* Connect your Notion account, then choose your Tasks database and your Due date property.\n* **Set your timezone** in the Trigger step above (Trigger → Configure → Schedule → Timezone).\n* Optional: Adjust the schedule in the Trigger step. By default, this workflow will run once per day at 11:57pm. You can make it run more frequently; just keep [Pipedream's credit limits](https://pipedream.com/pricing) if you're on the free plan. This workflow takes 1 credit per run.\n* Hit **Deploy** to enable the workflow.\n\n**Note:** This automation will automatically change the UTC Offset and Type formula properties in your task database. This helps things run smoothly; you can learn more about why these changes are made [in this reference section](https://thomasjfrank.com/notion-automated-recurring-tasks/#formula-property-changes).\n\n## More Resources\n\n**All My Notion Automations:**\n* [Notion Automations Hub](https://thomasjfrank.com/notion-automations/)\n\n**Want to get notified about updates to this workflow (and about new Notion templates, automations, and tutorials)?**\n* [Join my Notion Tips newsletter](https://thomasjfrank.com/fundamentals/#get-the-newsletter)`,
		},
		notion: {
			type: "app",
			app: "notion",
			description: `Connect your Notion account.`,
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

		// Identify and verify helper props
		const helperProps = {
			nextDueAPI: {
				name: "Next Due API",
				type: "formula",
				expression: "∅",
				manual: false,
			},
			type: {
				name: "Type",
				type: "formula",
				expression: `⏳One-Time`,
				manual: false,
			},
			utcOffset: {
				name: "UTC Offset",
				type: "formula",
				manual: false,
			},
		};

		const props = {
			dueProp: {
				type: "string",
				label: "Due Property",
				description: `Select the **Due** date property for your tasks. If you've renamed this property, choose that one instead.`,
				options: dueProps.map((prop) => ({
					label: prop,
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

		if (
			!properties[helperProps.nextDueAPI.name] ||
			properties[helperProps.nextDueAPI.name].type !==
				helperProps.nextDueAPI.type ||
			!properties[helperProps.nextDueAPI.name].formula.expression.includes(
				helperProps.nextDueAPI.expression
			)
		) {
			helperProps.nextDueAPI.manual = true;

			// If the database contains the Smart List property, it's likely Ultimate Brain. Adjust warning to link to the Formulas 2.0 update.
			if (properties["Smart List"]) {
				props.nextDueAPIWarning = {
					type: "alert",
					alertType: "warning",
					content: `Your chosen Target Database does not contain a **Next Due API** formula property. This workflow requires this property to function. If you have renamed it in your database, please set it in the Next Due API Property field below. If your database doesn't contain it, please use one of the templates listed in the "Compatibility" section in the instructions above.\n\nP.S. – It looks like you're using Ultimate Brain. You might be using an older version of the template; if so, you can [upgrade using our Formulas 2.0 guide](https://thomasfrank.notion.site/Formulas-2-0-1b6f3228097e4293993af2f3b9f7c738) in order to add all the needed properties for this workflow.`,
				};
			} else {
				props.nextDueAPIWarning = {
					type: "alert",
					alertType: "warning",
					content: `Your chosen Target Database does not contain a **Next Due API** formula property. This workflow requires this property to function. If you have renamed it in your database, please set it in the Next Due API Property field below. If your database doesn't contain it, please use one of the templates listed in the "Compatibility" section in the instructions above.`,
				};
			}
			

			props.nextDueAPIProp = {
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
			};
		}

		if (
			!properties[helperProps.type.name] ||
			properties[helperProps.type.name].type !== helperProps.type.type ||
			!properties[helperProps.type.name].formula.expression.includes(
				helperProps.type.expression
			)
		) {
			helperProps.type.manual = true;

			props.typeWarning = {
				type: "alert",
				alertType: "warning",
				content: `Your chosen Target Database does not contain a **Type** formula property. This workflow requires this property to function. If you have renamed it in your database, please set it in the Type Property field below. If your database doesn't contain it, please use one of the templates listed in the "Compatibility" section in the instructions above.`,
			};

			props.typeProp = {
				type: "string",
				label: "Type Property",
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
			};
		}

		if (
			!properties[helperProps.utcOffset.name] ||
			properties[helperProps.utcOffset.name].type !== helperProps.utcOffset.type
		) {
			helperProps.utcOffset.manual = true;

			props.utcOffsetWarning = {
				type: "alert",
				alertType: "warning",
				content: `Your chosen Target Database does not contain a **UTC Offset** formula property. This workflow requires this property to function. If you have renamed it in your database, please set it in the UTC Offset Property field below. If your database doesn't contain it, please use one of the templates listed in the "Compatibility" section in the instructions above.`,
			};

			props.utcOffsetProp = {
				type: "string",
				label: "UTC Offset Property",
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
			};
		}

		props.finalInstructions = {
			type: "alert",
			alertType: "info",
			content: `## Final Steps\n\nOnce you've finished setting all of your properties above, do the following:\n\n1. For testing, make sure you have at least **finished** recurring task in your Notion database.\n\n2. Click **Test**, and check that your finished task has been set back to its "un-done" status (based on your chosen Task Status property).\n\n3. If everything looks good, click **Deploy** to make the workflow live.\n\nYou can also add additional steps to this workflow. For example, in the Exports tab, I've include a Workflow Report object with both a standard-Markdown and Slack-specific-Markdown version of the report. You can use either one to send a report to Slack, email, Discord, etc.`
		}

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
											expression: `if(empty(prop("Recur Interval")), "⏳One-Time", "🔄Recurring")`,
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
				console.log(
					`Current Done Status Options: ${config.done.not_started.name} (for Not Started) and ${config.done.completed.name} (for Done). Checking the database for the most up-to-date status option names...`
				);
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

			// Set the Next Due API property
			if (this.nextDueAPIProp) {
				console.log(
					`Setting the Next Due API property to user-set property: ${this.nextDueAPIProp}.`
				);
				config.nextDueAPI = JSON.parse(this.nextDueAPIProp);
			} else {
				if (
					!response.properties["Next Due API"] ||
					response.properties["Next Due API"].type !== "formula"
				) {
					throw new Error(
						`Error: Your target database is missing the "Next Due API" property. This workflow requires this to function, and it must be a formula-type property. If you have renamed it in your database, please click "Refresh Fields" at the bottom of the Configure tab above, then set the "Next Due API Property" field manually. If your database does not contain this property, please use one of the templates listed in the "Compatibility" section in the instructions above.`
					);
				}

				console.log(
					`Setting the Next Due API property to matched property from the Notion database: ${JSON.stringify(
						response.properties["Next Due API"]
					)}.`
				);

				config.nextDueAPI = {
					id: response.properties["Next Due API"].id,
					name: "Next Due API",
					type: "formula",
				};
			}

			// Set the Type property
			if (this.typeProp) {
				console.log(
					`Setting the Type property to user-set property: ${this.typeProp}.`
				);
				config.type = JSON.parse(this.typeProp);
			} else {
				if (
					!response.properties["Type"] ||
					response.properties["Type"].type !== "formula"
				) {
					throw new Error(
						`Error: Your target database is missing the "Type" property. This workflow requires this to function, and it must be a formula-type property. If you have renamed it in your database, please click "Refresh Fields" at the bottom of the Configure tab above, then set the "Type Property" field manually. If your database does not contain this property, please use one of the templates listed in the "Compatibility" section in the instructions above.`
					);
				}

				console.log(
					`Setting the Type property to matched property from the Notion database: ${JSON.stringify(
						response.properties["Type"]
					)}.`
				);

				config.type = {
					id: response.properties["Type"].id,
					name: "Type",
					type: "formula",
				};
			}

			// Set the UTC Offset property
			if (this.utcOffsetProp) {
				console.log(
					`Setting the UTC Offset property to user-set property: ${this.utcOffsetProp}.`
				);
				config.utcOffset = JSON.parse(this.utcOffsetProp);
			} else {
				if (
					!response.properties["UTC Offset"] ||
					response.properties["UTC Offset"].type !== "formula"
				) {
					throw new Error(
						`Error: Your target database is missing the "UTC Offset" property. This workflow requires this to function, and it must be a formula-type property. If you have renamed it in your database, please click "Refresh Fields" at the bottom of the Configure tab above, then set the "UTC Offset Property" field manually. If your database does not contain this property, please use one of the templates listed in the "Compatibility" section in the instructions above.`
					);
				}

				console.log(
					`Setting the UTC Offset property to matched property from the Notion database: ${JSON.stringify(
						response.properties["UTC Offset"]
					)}.`
				);

				config.utcOffset = {
					id: response.properties["UTC Offset"].id,
					name: "UTC Offset",
					type: "formula",
				};
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
				let doneFilter = {};
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
				};

				console.log(`Update params:`);
				console.dir(params);

				await retry(
					async (bail) => {
						try {
							const resp = await limiter.schedule(() => notion.pages.update(params));

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
		console.log(
			`Setting up configs (helper configs will be set in the Schema Update step)...`
		);
		config.due = JSON.parse(this.dueProp);
		config.done = JSON.parse(this.doneProp);

		// Check for type on the Due and Done properties
		if (!config.due.type || config.due.type !== "date") {
			throw new Error(
				`Error: The Due property either doesn't have a type set, or its type is not "date". Please hit the "Refresh Fields" button at the bottom of the Configure tab above, then re-set the Due Property field.`
			);
		}

		if (!config.done.type || (
			config.done.type !== "checkbox" && config.done.type !== "status"
		)) {
			throw new Error(
				`Error: The Done property either doesn't have a type set, or its type is not one of the supported options ("checkbox" or "status"). Please hit the "Refresh Fields" button at the bottom of the Configure tab above, then re-set the Done Property field.`
			);
		}

		if (this.donePropStatusNotStarted) {
			config.done.not_started = JSON.parse(this.donePropStatusNotStarted);
		}
		if (this.donePropStatusCompleted) {
			config.done.completed = JSON.parse(this.donePropStatusCompleted);
		}
		if (this.secondaryDoneProp) {
			config.secondary_done = JSON.parse(this.secondaryDoneProp);

			if (!config.secondary_done.type || (
				config.secondary_done.type !== "checkbox" && config.secondary_done.type !== "status"
			)) {
				throw new Error(
					`Error: The Secondary Done property either doesn't have a type set, or its type is not one of the supported options ("checkbox" or "status"). Please hit the "Refresh Fields" button at the bottom of the Configure tab above, then re-set the Secondary Done Property field.`
				);
			}

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

		console.log(
			`Initial configs, based on user's configured properties here in Pipedream:`
		);
		console.dir(config);

		// Set up our Notion client
		console.log(`Setting up Notion client...`);
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
		console.log(
			`Updating UTC Offset. This workflow sets your UTC Offset property in Notion to match the configured timezone in the Trigger step. If you need to change it, you can do so in the Trigger step's Configure tab -> Schedule menu -> Timezone field.`
		);
		const utc_offset = await this.setUTCOffset(
			notion,
			this.steps.trigger.event.timezone_configured.iso8601.timestamp,
			limiter
		);

		console.log(
			`Updated UTC offset to ${
				utc_offset.properties[config.utcOffset.name].formula.expression
			}, matching workflow's timezone setting: ${
				this.steps.trigger.event.timezone_configured.timezone
			}`
		);

		// Query Notion for completed recurring tasks
		console.log(`Querying Notion for completed recurring tasks.`);
		if (config.secondary_done) {
			console.log(
				`Secondary Task Status property is set. Checking for tasks that are marked as Done in either the main or secondary Task Status properties.`
			);
		} else {
			console.log(
				`Secondary Task Status property is not set. Checking for tasks that are marked as Done in the main Task Status property.`
			);
		}
		const completedRecurringTasks = await this.queryNotion(notion, limiter);

		console.log(
			`Found ${completedRecurringTasks.length} Completed Recurring Tasks:`
		);
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
		};

		if (updatedTasks.length === 0) {
			$.export("$summary", `Found no tasks to update.`)
			$.export("Workflow Report", {
				markdown: `Notion Recurring Tasks Report:
			
Found no tasks to update.`,
				slack: `Notion Recurring Tasks Report:
			
Found no tasks to update.`,
			});
		} else {
			$.export(
				"$summary",
				`Successfully updated ${updatedTasks.length} tasks.`
			)
			$.export(
				"Workflow Report",
				{
					markdown: `Notion Recurring Tasks Report:
				
Successfully updated ${updatedTasks.length} tasks:
			
${updatedTasks
	.map((task) => {
		const taskTitle = Object.entries(task.properties).find(
			([key, value]) => value.type === "title"
		)?.[0];
		return (
			"- [" +
			task.properties[taskTitle].title[0].text.content +
			"](" +
			task.url +
			") (Next Due: " +
			task.properties[config.due.name].date.start +
			")"
		);
	})
	.join("\n")}`,
					slack: `Notion Recurring Tasks Report:
				
Successfully updated ${updatedTasks.length} tasks:
			
${updatedTasks
	.map((task) => {
		const taskTitle = Object.entries(task.properties).find(
			([key, value]) => value.type === "title"
		)?.[0];
		return (
			"- <" +
			task.url + "|" + task.properties[taskTitle].title[0].text.content +
			"> (Next Due: " +
			task.properties[config.due.name].date.start +
			")"
		);
	})
	.join("\n")}`,
				}
);
		}
		return exportedData;
	},
};
