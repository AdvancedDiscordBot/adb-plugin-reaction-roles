// Run with: npm test  (or) node test/local-harness.js
//
// Loads the plugin against a bot-faithful mock ctx (test/mock-ctx.js), then
// exercises each registered subcommand with a fake interaction.

const assert = require("node:assert");
const { Client, PermissionFlagsBits } = require("discord.js");
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
	const { ctx, registeredCommands, emitEvent, models } = createMockCtx({
		pluginName: "adb-plugin-reaction-roles",
	});

	await load(ctx);

	assert.ok(registeredCommands.has("reactionrole"), "expected /reactionrole to be registered");

	const command = registeredCommands.get("reactionrole");
	const selectionModel = models.get("plugin_adb-plugin-reaction-roles_selection");
	assert.ok(selectionModel, "the member-page selection model must be registered before any interactions");
	for (const member of [null, {}, { permissions: { has: () => false } }]) {
		const denied = createFakeInteraction({ _subcommand: "create" });
		denied.member = member;
		await command.execute(denied, ctx.client);
		assert.match(denied.replies[0].content, /Manage Server/);
		assert.strictEqual(await models.get("plugin_adb-plugin-reaction-roles_reactionPanel").countDocuments({}), 0);
	}

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
	await command.execute(createInt, ctx.client);
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
		role: { id: "role-123", name: "Red", position: 1, managed: false },
		emoji: "🔴",
		label: "Red Role",
		description: "Select to get the Red role",
	});
	await command.execute(addInt, ctx.client);
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
		channelId: "test-channel-id",
		message: { id: "test-message-id" },
		user: { id: testMember.id },
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
		channelId: "test-channel-id",
		message: { id: "test-message-id" },
		user: { id: testMember.id },
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

	console.log("Testing component selection boundaries");
	for (const invalid of [
		{ type: "button", customId: "reactionrole:button:test-message-id:colors:unconfigured" },
		{ type: "dropdown", values: ["unconfigured"] },
		{ type: "dropdown", values: ["role-123", "unconfigured"] },
		{ type: "dropdown", mode: "single", values: ["role-123", "role-456"] },
		{ type: "dropdown", mode: "exclusive", values: [] },
		{ type: "dropdown", values: ["role-123", "role-123"] },
		{ type: "dropdown", message: { id: "copied-message" } },
		{ type: "dropdown", channelId: "wrong-channel" },
		{ type: "dropdown", customId: "reactionrole:button:test-message-id:colors:role-123" },
		{ type: "button", customId: "reactionrole:button:test-message-id:colors:role-123:extra" },
		{ type: "button", groupType: "dropdown" },
		{ type: "dropdown", guildId: "other-guild" },
		{ type: "dropdown", guild: null, guildId: null },
	]) {
		panelDoc.groups[0].type = invalid.groupType || invalid.type;
		panelDoc.groups[0].selectionMode = invalid.mode || "multiple";
		await panelDoc.save();
		addedRoles = [];
		removedRoles = [];
		const before = await selectionModel.countDocuments({});
		const interaction = {
			...dropdownInteraction,
			customId: `reactionrole:${invalid.type}:test-message-id:colors${invalid.type === "button" ? ":role-123" : ""}`,
			values: ["role-123"],
			...invalid,
			isButton: () => invalid.type === "button",
			isStringSelectMenu: () => invalid.type === "dropdown",
		};
		await emitEvent("interactionCreate", interaction);
		assert.deepStrictEqual(addedRoles, [], `invalid selection must not grant roles: ${JSON.stringify(invalid)}`);
		assert.deepStrictEqual(removedRoles, [], "invalid selection must not remove existing roles");
		assert.strictEqual(await selectionModel.countDocuments({}), before, "rejected selections must not write audit entries");
	}

	console.log("Testing managed roles and hierarchy before any group mutation");
	const getRole = testGuild.roles.cache.get;
	for (const type of ["button", "dropdown"]) {
		panelDoc.groups[0].type = type;
		panelDoc.groups[0].selectionMode = "single";
		await panelDoc.save();
		for (const blockedId of ["role-123", "role-456"]) {
			for (const blocked of [{ managed: true }, { position: 10 }, { position: 11 }]) {
				testGuild.roles.cache.get = (id) => ({ ...getRole(id), ...(id === blockedId ? blocked : {}) });
				addedRoles = [];
				removedRoles = [];
				await emitEvent("interactionCreate", type === "button" ? buttonInteraction : dropdownInteraction);
				assert.deepStrictEqual(addedRoles, [], "a blocked selected or displaced role must stop the entire change");
				assert.deepStrictEqual(removedRoles, [], "check all removals before changing any role");
			}
		}
	}
	testGuild.roles.cache.get = getRole;

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
			channelId: "test-channel-id",
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
	await command.execute(listInt, ctx.client);
	assert.ok(listInt.replies.length > 0, "expected a reply for list command");
	const listEmbed = listInt.replies[0].embeds[0];
	assert.strictEqual(listEmbed.data.title, "Reaction Role Panels");

	console.log("Testing subcommand: refresh");
	const refreshInt = createFakeInteraction({
		_subcommand: "refresh",
		message_id: "test-message-id",
	});
	await command.execute(refreshInt, ctx.client);
	assert.match(refreshInt.replies[0].content, /successfully refreshed/i);

	console.log("Testing subcommand: remove");
	const removeInt = createFakeInteraction({
		_subcommand: "remove",
		message_id: "test-message-id",
		role: { id: "role-123", name: "Red" },
	});
	await command.execute(removeInt, ctx.client);
	assert.match(removeInt.replies[0].content, /Successfully removed role/i);

	const afterRemovePanels = await reactionPanelModel.find({ guildId: "test-guild" });
	assert.strictEqual(afterRemovePanels[0].groups[0].roles.length, 1, "expected 1 role left in the group");

	console.log("Testing subcommand: delete");
	const deleteInt = createFakeInteraction({
		_subcommand: "delete",
		message_id: "test-message-id",
	});
	await command.execute(deleteInt, ctx.client);
	assert.match(deleteInt.replies[0].content, /has been deleted/i);

	const finalPanels = await reactionPanelModel.find({ guildId: "test-guild" });
	assert.strictEqual(finalPanels.length, 0, "expected panel to be deleted from DB");

	console.log("Testing persisted panel edits, component limits, and recreation");
	const messages = new Map();
	let messageSequence = 100000000000000000n;
	const serialize = (payload) => ({
		embeds: (payload.embeds || []).map((embed) => embed.toJSON()),
		components: (payload.components || []).map((row) => row.toJSON()),
	});
	const channel = {
		id: "test-channel-id",
		isTextBased: () => true,
		permissionsFor: () => ({ has: () => true }),
		messages: { fetch: async (id) => messages.get(id) || null },
		send: async (payload) => {
			const message = {
				id: String(++messageSequence), payload: serialize(payload),
				edit: async (next) => { message.payload = serialize(next); return message; },
				delete: async () => messages.delete(message.id),
				react: async () => {},
				reactions: { cache: new Map() },
			};
			messages.set(message.id, message);
			return message;
		},
	};
	const panelGuild = { ...testGuild, channels: { fetch: async () => channel } };
	const run = async (options) => {
		const interaction = createFakeInteraction({ _guild: panelGuild, ...options });
		await command.execute(interaction, ctx.client);
		return interaction;
	};
	await run({ _subcommand: "create", channel, title: "Round trip", group_name: "base", type: "button" });
	let panel = (await reactionPanelModel.find({ guildId: "test-guild" }))[0];
	const newGroupAdd = await run({
		_subcommand: "add", message_id: panel.messageId, role: { id: "role-new", name: "New", position: 1 },
		group_name: "new_group", group_label: "New group", group_type: "button",
	});
	assert.match(newGroupAdd.replies[0].content, /Successfully added/);
	panel = await reactionPanelModel.findById(panel._id);
	assert.strictEqual(panel.groups[1].roles[0]?.roleId, "role-new", "Mongoose must persist the first role added to a new group");
	const oldMessageId = panel.messageId;
	messages.delete(oldMessageId);
	await run({ _subcommand: "refresh", message_id: oldMessageId });
	panel = await reactionPanelModel.findById(panel._id);
	assert.notStrictEqual(panel.messageId, oldMessageId, "refresh must persist the replacement message ID");
	const recreatedMessage = messages.get(panel.messageId);
	const customId = recreatedMessage.payload.components[0].components[0].custom_id;
	assert.strictEqual(customId, `reactionrole:button:${panel.messageId}:new_group:role-new`, "recreated buttons must reference the new message, not the deleted one");
	addedRoles = [];
	removedRoles = [];
	testMember.roles.cache.has = () => false;
	await emitEvent("interactionCreate", { ...buttonInteraction, customId, message: { id: panel.messageId } });
	assert.deepStrictEqual(addedRoles, ["role-new"], "recreated panels must be usable through the event emitter");

	console.log("Testing allowed selections and emoji hierarchy through live event registrations");
	panel.groups[1].roles.push({ roleId: "role-other", label: "Other", emoji: "<:other:456>" });
	panel.groups[1].roles[0].emoji = "<:new:123>";
	panel.groups[1].selectionMode = "exclusive";
	await panel.save();
	const held = new Set(["role-new"]);
	testMember.roles.cache.has = (id) => held.has(id);
	testMember.roles.add = async (ids) => {
		for (const id of Array.isArray(ids) ? ids : [ids]) held.add(id);
	};
	testMember.roles.remove = async (ids) => {
		for (const id of Array.isArray(ids) ? ids : [ids]) held.delete(id);
	};
	await emitEvent("interactionCreate", { ...buttonInteraction, customId, message: { id: panel.messageId } });
	assert.deepStrictEqual([...held], ["role-new"], "exclusive buttons cannot toggle off a selected role");
	panel.groups[1].type = "dropdown";
	await panel.save();
	const exclusiveDropdown = {
		...dropdownInteraction, customId: `reactionrole:dropdown:${panel.messageId}:new_group`,
		message: { id: panel.messageId }, values: ["role-other"],
	};
	await emitEvent("interactionCreate", exclusiveDropdown);
	assert.deepStrictEqual([...held], ["role-other"], "exclusive dropdowns can switch between configured roles");
	await emitEvent("interactionCreate", { ...exclusiveDropdown, values: [] });
	assert.deepStrictEqual([...held], ["role-other"], "exclusive dropdowns cannot clear the last role");
	panel.groups[1].selectionMode = "single";
	await panel.save();
	await emitEvent("interactionCreate", { ...exclusiveDropdown, values: [] });
	assert.strictEqual(held.size, 0, "single dropdowns still allow clearing the selection");
	panel.groups[1].type = "button";
	panel.groups[1].selectionMode = "multiple";
	await panel.save();
	await emitEvent("interactionCreate", { ...buttonInteraction, customId, message: { id: panel.messageId } });
	assert.ok(held.has("role-new"), "multiple buttons grant their configured role");
	await emitEvent("interactionCreate", { ...buttonInteraction, customId, message: { id: panel.messageId } });
	assert.strictEqual(held.size, 0, "multiple buttons still toggle their role off");

	panel.groups[1].type = "emoji";
	panel.groups[1].selectionMode = "single";
	await panel.save();
	const emojiReaction = {
		...testReaction,
		emoji: { id: "123", name: "new", toString: () => "<:new:123>" },
		message: { ...testReaction.message, id: panel.messageId },
	};
	held.add("role-other");
	for (const blockedId of ["role-new", "role-other"]) {
		testGuild.roles.cache.get = (id) => ({ ...getRole(id), managed: id === blockedId });
		await emitEvent("messageReactionAdd", emojiReaction, testUser);
		assert.deepStrictEqual([...held], ["role-other"], "emoji switches must check target and displaced roles before mutation");
	}
	testGuild.roles.cache.get = getRole;
	await emitEvent("messageReactionAdd", emojiReaction, testUser);
	assert.deepStrictEqual([...held], ["role-new"], "valid emoji selections still switch roles");
	testGuild.roles.cache.get = (id) => ({ ...getRole(id), managed: true });
	await emitEvent("messageReactionRemove", emojiReaction, testUser);
	assert.deepStrictEqual([...held], ["role-new"], "emoji removals must not mutate managed roles");
	testGuild.roles.cache.get = getRole;
	await emitEvent("messageReactionRemove", emojiReaction, testUser);
	assert.strictEqual(held.size, 0, "valid emoji removals still revoke the role");
	panel.groups[1].selectionMode = "exclusive";
	await panel.save();
	held.add("role-new");
	const restoredReactions = [];
	emojiReaction.message.react = async (emoji) => restoredReactions.push(emoji);
	await emitEvent("messageReactionRemove", emojiReaction, testUser);
	assert.deepStrictEqual([...held], ["role-new"], "exclusive reaction removal must retain the role");
	assert.deepStrictEqual(restoredReactions, ["123"], "restore the bot reaction through Message.react, not a nonexistent MessageReaction method");

	for (const name of ["bad:name", " ", "g".repeat(80)]) {
		const before = await reactionPanelModel.countDocuments({});
		const sentBefore = messages.size;
		const result = await run({ _subcommand: "create", channel, title: "Invalid", group_name: name, type: "button" });
		assert.ok(result.replies.length, "invalid group names must receive a useful error");
		assert.strictEqual(await reactionPanelModel.countDocuments({}), before, "invalid component identifiers must not be persisted");
		assert.strictEqual(messages.size, sentBefore, "invalid panel creation must not send a placeholder");
	}

	const roles = (count) => Array.from({ length: count }, (_, i) => ({ roleId: `role-${i}`, label: `Role ${i}` }));
	const group = (name, type, count) => ({ name, label: name, type, selectionMode: "multiple", roles: roles(count) });
	for (const limit of [
		{ name: "dropdown options", groups: [group("base", "dropdown", 25)] },
		{ name: "button rows", groups: [group("base", "button", 25)] },
		{ name: "mixed rows", groups: [group("base", "button", 21)], newGroup: "extra" },
		{ name: "group count", groups: Array.from({ length: 5 }, (_, i) => group(`group${i}`, "dropdown", 0)), newGroup: "sixth" },
		{ name: "custom ID length", groups: [group("g".repeat(80), "button", 0)] },
		{ name: "embed field size", groups: [{ ...group("base", "dropdown", 20), roles: roles(20).map((r) => ({ ...r, label: "x".repeat(80) })) }] },
		{ name: "emoji count", groups: [{ ...group("base", "emoji", 20), roles: roles(20).map((r, i) => ({ ...r, emoji: `<:emoji:${1000 + i}>` })) }], emoji: "<:extra:2000>" },
	]) {
		const message = await channel.send({});
		const limitedPanel = await reactionPanelModel.create({
			guildId: "test-guild", channelId: channel.id, messageId: message.id, title: limit.name, groups: limit.groups,
		});
		const before = JSON.stringify(limitedPanel.toObject());
		const result = await run({
			_subcommand: "add", message_id: message.id, role: { id: "role-extra", name: "Extra", position: 1 },
			group_name: limit.newGroup || null,
			emoji: limit.emoji || null,
		});
		assert.ok(result.replies[0]?.content && !result.replies[0].content.includes("Successfully added"), `reject ${limit.name}`);
		assert.strictEqual(JSON.stringify((await reactionPanelModel.findById(limitedPanel._id)).toObject()), before, `${limit.name} rejection must not save changes`);
		assert.deepStrictEqual(message.payload.components, [], `${limit.name} rejection must not edit Discord`);
	}

	const validMessage = await channel.send({});
	const validPanel = await reactionPanelModel.create({
		guildId: "test-guild", channelId: channel.id, messageId: validMessage.id, title: "At the limit", groups: [group("base", "button", 24)],
	});
	const limitAdd = await run({ _subcommand: "add", message_id: validMessage.id, role: { id: "last-role", name: "Last", position: 1 } });
	assert.match(limitAdd.replies[0].content, /Successfully added/);
	assert.strictEqual(validMessage.payload.components.length, 5);
	assert.ok(validMessage.payload.components.every((row) => row.components.length === 5));
	assert.strictEqual((await reactionPanelModel.findById(validPanel._id)).groups[0].roles.length, 25);
	validPanel.groups[0].type = "dropdown";
	await validPanel.save();
	const dropdownLimitAdd = await run({ _subcommand: "add", message_id: validMessage.id, role: { id: "last-role", name: "Last", position: 1 } });
	assert.match(dropdownLimitAdd.replies[0].content, /Successfully added/);
	assert.strictEqual(validMessage.payload.components[0].components[0].options.length, 25);

	for (const role of [
		{ id: "managed", name: "Managed", position: 1, managed: true },
		{ id: "test-guild", name: "everyone", position: 0 },
		{ id: "too-high", name: "High", position: 10 },
	]) {
		const before = JSON.stringify((await reactionPanelModel.findById(panel._id)).toObject());
		await run({ _subcommand: "add", message_id: panel.messageId, role });
		assert.strictEqual(JSON.stringify((await reactionPanelModel.findById(panel._id)).toObject()), before, "unassignable roles must not be configured");
	}

	console.log("Testing role changes with real Discord.js members before gateway cache updates");
	const client = new Client({ intents: [] });
	const botId = "100000000000000001";
	const [botRoleId, oldRoleId, newRoleId, outsideRoleId] = ["100000000000000004", "100000000000000005", "100000000000000006", "100000000000000007"];
	client.user = client.users._add({ id: botId, username: "bot", discriminator: "0", bot: true });
	const guild = client.guilds._add({ id: "100000000000000002", name: "Boundary guild", roles: [] });
	for (const [id, position, permissions] of [
		[guild.id, 0, "0"], [botRoleId, 10, String(PermissionFlagsBits.ManageRoles)],
		[oldRoleId, 1, "0"], [newRoleId, 2, "0"], [outsideRoleId, 3, "0"],
	]) guild.roles._add({ id, name: id, position, permissions });
	guild.members._add({ user: client.user, roles: [botRoleId], joined_at: new Date().toISOString() });
	const memberData = { user: { id: "100000000000000003", username: "member", discriminator: "0" }, roles: [oldRoleId, outsideRoleId], joined_at: new Date().toISOString() };
	const discordMember = guild.members._add(memberData);
	let liveRoles;
	client.rest.patch = async (route, { body }) => {
		liveRoles = new Set(body.roles.filter((id) => id !== guild.id));
		return { ...memberData, roles: [...liveRoles] };
	};
	client.rest.put = async (route) => { liveRoles.add(route.split("/").at(-1)); };
	client.rest.delete = async (route) => { liveRoles.delete(route.split("/").at(-1)); };
	for (const mode of ["multiple", "single", "exclusive"]) {
		liveRoles = new Set(memberData.roles);
		const boundaryPanel = await reactionPanelModel.create({
			guildId: guild.id, channelId: "boundary-channel", messageId: `boundary-${mode}`, title: "Boundary",
			groups: [{ name: "roles", label: "Roles", type: "dropdown", selectionMode: mode,
				roles: [{ roleId: oldRoleId }, { roleId: newRoleId }] }],
		});
		const interaction = {
			...dropdownInteraction, guild, guildId: guild.id, channelId: boundaryPanel.channelId,
			message: { id: boundaryPanel.messageId }, user: discordMember.user, member: discordMember,
			customId: `reactionrole:dropdown:${boundaryPanel.messageId}:roles`, values: [newRoleId],
		};
		await emitEvent("interactionCreate", interaction);
		assert.deepStrictEqual([...liveRoles].sort(), [newRoleId, outsideRoleId], `${mode} must replace the selected group roles without restoring removed roles`);
		assert.deepStrictEqual(discordMember._roles, memberData.roles, "REST role mutations return clones, not an updated gateway cache");
		const audit = await selectionModel.find({ messageId: boundaryPanel.messageId });
		assert.deepStrictEqual(audit.map((entry) => [entry.roleId, entry.action]), [[oldRoleId, "remove"], [newRoleId, "add"]]);
	}
	client.destroy();

	const manifest = require("../plugin.json");
	assert.deepStrictEqual(manifest.capabilities.system, ["raw-client"]);
	assert.deepStrictEqual(manifest.permissions.system, manifest.capabilities.system);
	assert.strictEqual(manifest.process.model, "persistent");
	assert.match(manifest.process.persistentReason, /raw-client/);
	console.log("OK: all local-harness checks passed");
}

main().catch((error) => {
	console.error("Local harness failed:", error);
	process.exit(1);
});
