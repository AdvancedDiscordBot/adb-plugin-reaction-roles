// Run with: npm test  (or) node test/local-harness.js
//
// Loads the plugin against a bot-faithful mock ctx (test/mock-ctx.js), then
// exercises each registered subcommand with a fake interaction.

const assert = require("node:assert");
const { load } = require("../index.js");
const { createMockCtx } = require("./mock-ctx");

function createFakeInteraction(options = {}) {
	const replies = [];
	const self = {
		guildId: options._guildId ?? "test-guild",
		guild: options._guild ?? {
			id: "test-guild",
			name: "Test Guild",
			roles: {
				cache: {
					get: (id) => ({ id, name: `Role-${id}`, position: 1 }),
				},
			},
			members: {
				fetchMe: async () => ({
					roles: {
						highest: { position: 10 },
					},
					permissions: {
						has: () => true,
					},
				}),
				fetch: async (id) => ({
					id,
					roles: {
						cache: {
							has: (roleId) => false,
						},
						add: async () => {},
						remove: async () => {},
					},
				}),
			},
			channels: {
				fetch: async (id) => {
					const mockMsg = {
						id: "test-message-id",
						edit: async () => {},
						react: async () => {},
						delete: async () => {},
						reactions: {
							cache: {
								get: () => null,
								has: () => false,
								find: () => null,
							},
						},
					};
					return {
						id,
						name: "test-channel",
						permissionsFor: () => ({
							has: () => true,
						}),
						send: async (payload) => mockMsg,
						messages: {
							fetch: async (msgId) => mockMsg,
						},
					};
				},
			},
		},
		user: options._user ?? { id: "test-user" },
		member: options._member ?? {
			permissions: {
				has: () => true,
			},
		},
		options: {
			getSubcommand: () => options._subcommand ?? null,
			getString: (name) => options[name] ?? null,
			getInteger: (name) => options[name] ?? null,
			getRole: (name) => options[name] ?? null,
			getChannel: (name) => options[name] ?? null,
		},
		deferred: false,
		replied: false,
		deferReply: async (opts) => {
			self.deferred = true;
			return;
		},
		reply: async (payload) => {
			self.replies.push(payload);
			self.replied = true;
			return payload;
		},
		editReply: async (payload) => {
			self.replies.push(payload);
			return payload;
		},
		replies,
	};
	return self;
}

async function main() {
	const { ctx, registeredCommands, emitEvent } = createMockCtx({
		pluginName: "adb-plugin-reaction-roles",
	});

	await load(ctx);

	assert.ok(registeredCommands.has("reactionrole"), "expected /reactionrole to be registered");

	const command = registeredCommands.get("reactionrole");

	console.log("Testing subcommand: create");
	const createInt = createFakeInteraction({
		_subcommand: "create",
		channel: {
			id: "test-channel-id",
			permissionsFor: () => ({
				has: () => true,
			}),
			send: async (payload) => {
				return {
					id: "test-message-id",
					edit: async () => {},
					react: async () => {},
					reactions: {
						cache: {
							get: () => null,
							has: () => false,
						},
					},
				};
			},
		},
		title: "Reaction Roles",
		description: "React to get your roles!",
		color: "#5865F2",
		group_name: "colors",
		group_label: "Colors",
		type: "dropdown",
		selection_mode: "multiple",
	});
	await command.execute(createInt, ctx);
	assert.ok(createInt.replies.length > 0, "expected a reply for create command");
	assert.match(createInt.replies[0].content, /Reaction Role Panel created successfully/i);

	const reactionPanelModel = ctx.defineModel("reactionPanel", require("../models/reactionPanel"));
	const panels = await reactionPanelModel.find({ guildId: "test-guild" });
	assert.strictEqual(panels.length, 1, "expected 1 panel in DB");
	assert.strictEqual(panels[0].title, "Reaction Roles");
	assert.strictEqual(panels[0].messageId, "test-message-id");
	assert.strictEqual(panels[0].groups[0].name, "colors");

	console.log("Testing subcommand: add");
	const addInt = createFakeInteraction({
		_subcommand: "add",
		message_id: "test-message-id",
		role: { id: "role-123", name: "Red" },
		emoji: "🔴",
		label: "Red Role",
		description: "Select to get the Red role",
	});
	await command.execute(addInt, ctx);
	assert.match(addInt.replies[0].content, /Successfully added role/i);

	const updatedPanels = await reactionPanelModel.find({ guildId: "test-guild" });
	assert.strictEqual(updatedPanels[0].groups[0].roles.length, 1, "expected 1 role in group");
	assert.strictEqual(updatedPanels[0].groups[0].roles[0].roleId, "role-123");
	assert.strictEqual(updatedPanels[0].groups[0].roles[0].emoji, "🔴");

	console.log("Testing events: interactionCreate (dropdown, multiple)");
	let addedRoles = [];
	let removedRoles = [];
	const testMember = {
		id: "member-456",
		roles: {
			cache: {
				has: (id) => false,
			},
			add: async (ids) => {
				addedRoles.push(...(Array.isArray(ids) ? ids : [ids]));
			},
			remove: async (ids) => {
				removedRoles.push(...(Array.isArray(ids) ? ids : [ids]));
			},
		},
	};
	const testGuild = {
		id: "test-guild",
		roles: {
			cache: {
				get: (id) => ({ id, name: `Role-${id}`, position: 1 }),
			},
		},
		members: {
			fetchMe: async () => ({
				roles: {
					highest: { position: 10 },
				},
				permissions: {
					has: () => true,
				},
			}),
			fetch: async (id) => testMember,
		},
	};

	const dropdownInteraction = {
		isButton: () => false,
		isStringSelectMenu: () => true,
		customId: "reactionrole:dropdown:test-message-id:colors",
		guildId: "test-guild",
		guild: testGuild,
		member: testMember,
		values: ["role-123"],
		deferred: false,
		replied: false,
		deferReply: async () => { dropdownInteraction.deferred = true; },
		editReply: async () => {},
		reply: async () => { dropdownInteraction.replied = true; },
	};

	await emitEvent("interactionCreate", dropdownInteraction);
	assert.ok(dropdownInteraction.deferred, "expected interaction to be deferred");
	assert.deepStrictEqual(addedRoles, ["role-123"], "expected role-123 to be added");

	const selectionModel = ctx.defineModel("selection", require("../models/selection"));
	let selections = await selectionModel.find({ guildId: "test-guild" });
	assert.strictEqual(selections.length, 1, "expected 1 selection doc after dropdown add");
	assert.strictEqual(selections[0].userId, "member-456");
	assert.strictEqual(selections[0].roleId, "role-123");
	assert.strictEqual(selections[0].action, "add");
	assert.strictEqual(selections[0].label, "Red Role");
	assert.strictEqual(selections[0].messageId, "test-message-id");

	// Change selection mode to single/button and test button click
	const panelDoc = await reactionPanelModel.findOne({ guildId: "test-guild", messageId: "test-message-id" });
	panelDoc.groups[0].type = "button";
	panelDoc.groups[0].selectionMode = "single";
	await panelDoc.save();

	console.log("Testing events: interactionCreate (button, single)");
	addedRoles = [];
	removedRoles = [];
	// Mock that they already have another role (say role-456) in the same group, so it should be removed
	testMember.roles.cache.has = (id) => id === "role-456";
	// Add role-456 to the group in DB so it recognizes it as part of the group
	panelDoc.groups[0].roles.push({ roleId: "role-456", label: "Other" });
	await panelDoc.save();

	const buttonInteraction = {
		isButton: () => true,
		isStringSelectMenu: () => false,
		customId: "reactionrole:button:test-message-id:colors:role-123",
		guildId: "test-guild",
		guild: testGuild,
		member: testMember,
		deferred: false,
		replied: false,
		deferReply: async () => { buttonInteraction.deferred = true; },
		editReply: async () => {},
		reply: async () => { buttonInteraction.replied = true; },
	};

	await emitEvent("interactionCreate", buttonInteraction);
	assert.deepStrictEqual(addedRoles, ["role-123"], "expected role-123 to be added");
	assert.deepStrictEqual(removedRoles, ["role-456"], "expected other role in group to be removed");

	selections = await selectionModel.find({ guildId: "test-guild" });
	const buttonAdds = selections.filter((s) => s.action === "add" && s.roleId === "role-123");
	const buttonRemoves = selections.filter((s) => s.action === "remove");
	assert.strictEqual(buttonAdds.length, 2, "expected dropdown + button adds for role-123");
	assert.strictEqual(buttonRemoves.length, 1, "expected 1 remove selection from single-mode switch");
	assert.strictEqual(buttonRemoves[0].roleId, "role-456");
	assert.strictEqual(buttonRemoves[0].userId, "member-456");
	assert.strictEqual(buttonRemoves[0].label, "Other");

	// Test emoji reactions
	console.log("Testing events: messageReactionAdd (emoji, multiple)");
	panelDoc.groups[0].type = "emoji";
	panelDoc.groups[0].selectionMode = "multiple";
	await panelDoc.save();

	const testReaction = {
		partial: false,
		emoji: {
			name: "🔴",
			id: null,
			toString: () => "🔴",
		},
		message: {
			id: "test-message-id",
			guildId: "test-guild",
			guild: testGuild,
			reactions: {
				cache: {
					find: () => null,
				},
			},
		},
	};
	const testUser = { id: "user-789", bot: false };

	addedRoles = [];
	testMember.roles.cache.has = () => false; // doesn't have role-123

	await emitEvent("messageReactionAdd", testReaction, testUser);
	assert.deepStrictEqual(addedRoles, ["role-123"], "expected role-123 to be added on reaction");

	const reactionAddSelections = await selectionModel.find({
		guildId: "test-guild",
		userId: "member-456",
		action: "add",
		roleId: "role-123",
	});
	assert.strictEqual(reactionAddSelections.length, 3, "expected reaction add to be recorded (dropdown, button, reaction)");
	assert.strictEqual(reactionAddSelections[2].label, "Red Role");

	console.log("Testing events: messageReactionRemove (emoji, multiple)");
	testMember.roles.cache.has = (id) => id === "role-123";
	removedRoles = [];

	await emitEvent("messageReactionRemove", testReaction, testUser);
	assert.deepStrictEqual(removedRoles, ["role-123"], "expected role-123 to be removed on reaction remove");

	const reactionRemoveSelections = await selectionModel.find({
		guildId: "test-guild",
		action: "remove",
		roleId: "role-123",
	});
	assert.strictEqual(reactionRemoveSelections.length, 1, "expected 1 remove selection for role-123");
	assert.strictEqual(reactionRemoveSelections[0].userId, "member-456");
	assert.strictEqual(reactionRemoveSelections[0].label, "Red Role");
	assert.strictEqual(reactionRemoveSelections[0].messageId, "test-message-id");

	console.log("Testing subcommand: list");
	const listInt = createFakeInteraction({
		_subcommand: "list",
	});
	await command.execute(listInt, ctx);
	assert.ok(listInt.replies.length > 0, "expected a reply for list command");
	const listEmbed = listInt.replies[0].embeds[0];
	assert.strictEqual(listEmbed.data.title, "Reaction Role Panels");

	console.log("Testing subcommand: refresh");
	const refreshInt = createFakeInteraction({
		_subcommand: "refresh",
		message_id: "test-message-id",
	});
	await command.execute(refreshInt, ctx);
	assert.match(refreshInt.replies[0].content, /successfully refreshed/i);

	console.log("Testing subcommand: remove");
	const removeInt = createFakeInteraction({
		_subcommand: "remove",
		message_id: "test-message-id",
		role: { id: "role-123", name: "Red" },
	});
	await command.execute(removeInt, ctx);
	assert.match(removeInt.replies[0].content, /Successfully removed role/i);

	const afterRemovePanels = await reactionPanelModel.find({ guildId: "test-guild" });
	assert.strictEqual(afterRemovePanels[0].groups[0].roles.length, 1, "expected 1 role left in the group");

	console.log("Testing subcommand: delete");
	const deleteInt = createFakeInteraction({
		_subcommand: "delete",
		message_id: "test-message-id",
	});
	await command.execute(deleteInt, ctx);
	assert.match(deleteInt.replies[0].content, /has been deleted/i);

	const finalPanels = await reactionPanelModel.find({ guildId: "test-guild" });
	assert.strictEqual(finalPanels.length, 0, "expected panel to be deleted from DB");

	console.log("OK: all local-harness checks passed");
}

main().catch((error) => {
	console.error("Local harness failed:", error);
	process.exit(1);
});
