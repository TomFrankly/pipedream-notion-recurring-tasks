/**
 * This is a very quick-and-dirty action that will add the most recent due date of a completed recurring task to that task's page body as a bullet list item.
 */

import { Client } from "@notionhq/client";
export default defineComponent({
	props: {
		notion: {
			type: "app",
			app: "notion",
		},
	},
	async run({ steps, $ }) {
		const notion = new Client({ auth: this.notion.$auth.oauth_access_token });

		// Code here
		const completedTasks =
			steps.notion_recurring_tasks.$return_value.completedRecurringTasks;

		for (let task of completedTasks) {
			const response = await notion.blocks.children.append({
				block_id: task.id,
				children: [
					{
						bulleted_list_item: {
							rich_text: [
								{
									type: "text",
									text: {
										content: task.properties.Due.date.start,
									},
								},
							],
						},
					},
				],
			});

			console.log(response);
		}
	},
});
