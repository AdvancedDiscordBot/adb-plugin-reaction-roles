const { PermissionFlagsBits } = require("discord.js");
const reactionroleCommand = require("./commands/reactionrole");
const reactionPanelSchema = require("./models/reactionPanel");
const selectionSchema = require("./models/selection");

function canManageRole(role, guild, botMember) {
	return role && role.id !== guild.id && !role.managed && role.position < botMember.roles.highest.position;
}

// Record one selection doc per role granted/removed (member page /me/self-roles).
function recordSelection(Selection, guildId, userId, group, roleIds, action, messageId) {
	const ids = Array.isArray(roleIds) ? roleIds : [roleIds];
	return Promise.all(
		ids.map((roleId) =>
			Selection.create({
				guildId,
				userId,
				roleId,
				label: group ? (group.roles.find((r) => r.roleId === roleId) || {}).label || null : null,
				action,
				messageId: messageId || null,
			})
		)
	);
}

/**
 * Every ADB plugin exports a single `load(ctx)` function. `ctx` is frozen
 * and namespaced to this plugin — see README.md for the full API reference.
 */
async function load(ctx) {
	// --- Register slash command -----------------------------------------
	ctx.registerCommand({
		data: reactionroleCommand.data,
		execute: (interaction) => reactionroleCommand.execute(interaction, ctx),
	});

	// --- Define namespaced DB model -----------------------------------------
	const ReactionPanel = ctx.defineModel("reactionPanel", reactionPanelSchema);
	const Selection = ctx.defineModel("selection", selectionSchema);

	// --- Component Interaction Handler (Buttons and Select Menus) ------------
	ctx.registerEvent("interactionCreate", async (interaction) => {
		try {
			if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
			if (!interaction.customId || !interaction.customId.startsWith("reactionrole:")) return;

			// Parse customId parts:
			// reactionrole:button:${messageId}:${groupName}:${roleId}
			// reactionrole:dropdown:${messageId}:${groupName}
			const parts = interaction.customId.split(":");
			const type = parts[1];
			const messageId = parts[2];
			const groupName = parts[3];

			await interaction.deferReply({ ephemeral: true });
			const expectedType = interaction.isButton() ? "button" : "dropdown";
			if (!interaction.guild || !interaction.guildId || type !== expectedType ||
				parts.length !== (type === "button" ? 5 : 4) || messageId !== interaction.message?.id) {
				return interaction.editReply({ content: "This role panel is invalid or out of date." });
			}
			const panel = await ReactionPanel.findOne({ guildId: interaction.guildId, channelId: interaction.channelId, messageId });
			if (!panel) return interaction.editReply({ content: "This role panel no longer exists." });

			const group = panel.groups.find((g) => g.name === groupName);
			if (!group || group.type !== type) {
				return interaction.editReply({ content: "This role group is invalid or out of date." });
			}
			const selectedRoleIds = type === "button" ? [parts[4]] : interaction.values;
			if (!Array.isArray(selectedRoleIds) || new Set(selectedRoleIds).size !== selectedRoleIds.length ||
				selectedRoleIds.some((id) => !group.roles.some((r) => r.roleId === id)) ||
				!["single", "multiple", "exclusive"].includes(group.selectionMode) ||
				(group.selectionMode !== "multiple" && selectedRoleIds.length > 1) ||
				(group.selectionMode === "exclusive" && selectedRoleIds.length === 0)) {
				return interaction.editReply({ content: "That selection is not allowed by this role group." });
			}

			const botMember = await interaction.guild.members.fetchMe();
			if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
				return interaction.editReply({
					content: "❌ I do not have permission to manage roles. Please contact a server admin.",
				});
			}

			const member = await interaction.guild.members.fetch(interaction.user.id);
			// Validate both selected and displaced roles before the first mutation.
			const affectedRoleIds = new Set(selectedRoleIds);
			if (type === "dropdown" || group.selectionMode !== "multiple") {
				for (const r of group.roles) {
					if (member.roles.cache.has(r.roleId)) affectedRoleIds.add(r.roleId);
				}
			}
			for (const id of affectedRoleIds) {
				if (!canManageRole(interaction.guild.roles.cache.get(id), interaction.guild, botMember)) {
					return interaction.editReply({ content: "I cannot manage a selected or existing role in this group. Check for deleted, managed, or higher roles." });
				}
			}

			if (interaction.isButton()) {
				const roleId = parts[4];
				const role = interaction.guild.roles.cache.get(roleId);
				if (!role) {
					return interaction.editReply({
						content: "❌ That role no longer exists in this server.",
					});
				}

				if (group.selectionMode === "multiple") {
					const hasRole = member.roles.cache.has(roleId);
					if (hasRole) {
						await member.roles.remove(roleId);
						await recordSelection(Selection, interaction.guildId, member.id, group, roleId, "remove", messageId);
						await interaction.editReply({ content: `✅ Removed the role **${role.name}**.` });
					} else {
						await member.roles.add(roleId);
						await recordSelection(Selection, interaction.guildId, member.id, group, roleId, "add", messageId);
						await interaction.editReply({ content: `✅ Assigned the role **${role.name}**.` });
					}
				} else if (group.selectionMode === "single") {
					const hasRole = member.roles.cache.has(roleId);
					if (hasRole) {
						await member.roles.remove(roleId);
						await recordSelection(Selection, interaction.guildId, member.id, group, roleId, "remove", messageId);
						await interaction.editReply({ content: `✅ Removed the role **${role.name}**.` });
					} else {
						// Remove other roles from the same group
						const otherRoleIds = group.roles.map((r) => r.roleId).filter((id) => id !== roleId);
						const rolesToRemove = otherRoleIds.filter((id) => member.roles.cache.has(id));
						if (rolesToRemove.length > 0) {
							await member.roles.remove(rolesToRemove);
							await recordSelection(Selection, interaction.guildId, member.id, group, rolesToRemove, "remove", messageId);
						}
						await member.roles.add(roleId);
						await recordSelection(Selection, interaction.guildId, member.id, group, roleId, "add", messageId);
						await interaction.editReply({
							content: `✅ Assigned the role **${role.name}**${rolesToRemove.length > 0 ? " (and removed other roles from this group)" : ""}.`,
						});
					}
				} else if (group.selectionMode === "exclusive") {
					const hasRole = member.roles.cache.has(roleId);
					if (hasRole) {
						return interaction.editReply({
							content: `ℹ️ You already have the role **${role.name}** (exclusive group).`,
						});
					} else {
						// Remove other roles from the same group
						const otherRoleIds = group.roles.map((r) => r.roleId).filter((id) => id !== roleId);
						const rolesToRemove = otherRoleIds.filter((id) => member.roles.cache.has(id));
						if (rolesToRemove.length > 0) {
							await member.roles.remove(rolesToRemove);
							await recordSelection(Selection, interaction.guildId, member.id, group, rolesToRemove, "remove", messageId);
						}
						await member.roles.add(roleId);
						await recordSelection(Selection, interaction.guildId, member.id, group, roleId, "add", messageId);
						await interaction.editReply({
							content: `✅ Switched to the role **${role.name}**.`,
						});
					}
				}
			} else if (interaction.isStringSelectMenu()) {
				const groupRoleIds = group.roles.map((r) => r.roleId);

				if (group.selectionMode === "multiple") {
					const rolesToAdd = selectedRoleIds.filter((id) => !member.roles.cache.has(id));
					const rolesToRemove = groupRoleIds.filter(
						(id) => !selectedRoleIds.includes(id) && member.roles.cache.has(id)
					);

					// Bulk add/remove rebuilds the member's roles from a gateway cache
					// that REST mutations do not update. Use role-specific endpoints.
					for (const roleId of rolesToRemove) {
						await member.roles.remove(roleId);
						await recordSelection(Selection, interaction.guildId, member.id, group, roleId, "remove", messageId);
					}
					for (const roleId of rolesToAdd) {
						await member.roles.add(roleId);
						await recordSelection(Selection, interaction.guildId, member.id, group, roleId, "add", messageId);
					}

					await interaction.editReply({
						content: "✅ Your role selection has been updated.",
					});
				} else if (group.selectionMode === "single" || group.selectionMode === "exclusive") {
					if (selectedRoleIds.length === 0) {
						// Only possible in single mode (exclusive has minValues 1)
						const rolesToRemove = groupRoleIds.filter((id) => member.roles.cache.has(id));
						if (rolesToRemove.length > 0) {
							await member.roles.remove(rolesToRemove);
							await recordSelection(Selection, interaction.guildId, member.id, group, rolesToRemove, "remove", messageId);
						}
						await interaction.editReply({
							content: "✅ Removed roles from this group.",
						});
					} else {
						const targetRoleId = selectedRoleIds[0];
						const role = interaction.guild.roles.cache.get(targetRoleId);
						const otherRoleIds = groupRoleIds.filter((id) => id !== targetRoleId);
						const rolesToRemove = otherRoleIds.filter((id) => member.roles.cache.has(id));

						if (rolesToRemove.length > 0) {
							await member.roles.remove(rolesToRemove);
							await recordSelection(Selection, interaction.guildId, member.id, group, rolesToRemove, "remove", messageId);
						}
						if (!member.roles.cache.has(targetRoleId)) {
							await member.roles.add(targetRoleId);
							await recordSelection(Selection, interaction.guildId, member.id, group, targetRoleId, "add", messageId);
						}

						await interaction.editReply({
							content: `✅ Updated your role to **${role ? role.name : targetRoleId}**.`,
						});
					}
				}
			}
		} catch (err) {
			ctx.logger.error("Error handling reaction role component interaction:", err);
			try {
				if (!interaction.replied && !interaction.deferred) {
					await interaction.reply({
						content: "❌ An error occurred while processing your roles.",
						ephemeral: true,
					});
				} else {
					await interaction.editReply({
						content: "❌ An error occurred while processing your roles.",
					});
				}
			} catch (_) {}
		}
	});

	// --- Emoji Reaction Add Handler -----------------------------------------
	ctx.registerEvent("messageReactionAdd", async (reaction, user) => {
		try {
			if (user.bot || !reaction.message.guildId) return;

			if (reaction.partial) {
				try {
					await reaction.fetch();
				} catch (error) {
					ctx.logger.error("Failed to fetch partial reaction:", error);
					return;
				}
			}

			const panel = await ReactionPanel.findOne({
				guildId: reaction.message.guildId,
				channelId: reaction.message.channelId,
				messageId: reaction.message.id,
			});
			if (!panel) return;

			// Find matching role/group
			let foundGroup = null;
			let foundRole = null;
			const reactionKey = reaction.emoji.id
				? reaction.emoji.toString() // custom emoji format
				: reaction.emoji.name; // unicode character

			for (const group of panel.groups) {
				if (group.type === "emoji") {
					const role = group.roles.find(
						(r) =>
							r.emoji === reactionKey ||
							r.emoji === reaction.emoji.name ||
							r.emoji === reaction.emoji.toString()
					);
					if (role) {
						foundGroup = group;
						foundRole = role;
						break;
					}
				}
			}

			if (!foundGroup || !foundRole) return;

			const guild = reaction.message.guild;
			const member = await guild.members.fetch(user.id).catch(() => null);
			if (!member) return;

			const botMember = await guild.members.fetchMe();
			if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) return;

			const role = guild.roles.cache.get(foundRole.roleId);
			if (!canManageRole(role, guild, botMember)) return;

			if (foundGroup.selectionMode === "multiple") {
				if (!member.roles.cache.has(role.id)) {
					await member.roles.add(role.id);
					await recordSelection(Selection, guild.id, member.id, foundGroup, role.id, "add", reaction.message.id);
				}
			} else if (foundGroup.selectionMode === "single" || foundGroup.selectionMode === "exclusive") {
				// Remove other roles from this group
				const otherRoles = foundGroup.roles.filter((r) => r.roleId !== foundRole.roleId);
				const otherRoleIds = otherRoles.map((r) => r.roleId);
				const rolesToRemove = otherRoleIds.filter((id) => member.roles.cache.has(id));
				if (rolesToRemove.some((id) => !canManageRole(guild.roles.cache.get(id), guild, botMember))) return;

				if (rolesToRemove.length > 0) {
					await member.roles.remove(rolesToRemove);
					await recordSelection(Selection, guild.id, member.id, foundGroup, rolesToRemove, "remove", reaction.message.id);
				}

				if (!member.roles.cache.has(role.id)) {
					await member.roles.add(role.id);
					await recordSelection(Selection, guild.id, member.id, foundGroup, role.id, "add", reaction.message.id);
				}

				// Remove user's reactions for other roles in this group
				for (const otherRole of otherRoles) {
					if (otherRole.emoji) {
						const otherEmojiKey = otherRole.emoji.includes(":")
							? otherRole.emoji.split(":")[2].replace(">", "")
							: otherRole.emoji;

						const otherReaction = reaction.message.reactions.cache.find(
							(re) =>
								re.emoji.id === otherEmojiKey ||
								re.emoji.name === otherEmojiKey ||
								re.emoji.toString() === otherRole.emoji
						);

						if (otherReaction) {
							await otherReaction.users.remove(user.id).catch(() => null);
						}
					}
				}
			}
		} catch (err) {
			ctx.logger.error("Error in messageReactionAdd event handler:", err);
		}
	});

	// --- Emoji Reaction Remove Handler -----------------------------------------
	ctx.registerEvent("messageReactionRemove", async (reaction, user) => {
		try {
			if (user.bot || !reaction.message.guildId) return;

			if (reaction.partial) {
				try {
					await reaction.fetch();
				} catch (error) {
					ctx.logger.error("Failed to fetch partial reaction:", error);
					return;
				}
			}

			const panel = await ReactionPanel.findOne({
				guildId: reaction.message.guildId,
				channelId: reaction.message.channelId,
				messageId: reaction.message.id,
			});
			if (!panel) return;

			// Find matching role/group
			let foundGroup = null;
			let foundRole = null;
			const reactionKey = reaction.emoji.id
				? reaction.emoji.toString()
				: reaction.emoji.name;

			for (const group of panel.groups) {
				if (group.type === "emoji") {
					const role = group.roles.find(
						(r) =>
							r.emoji === reactionKey ||
							r.emoji === reaction.emoji.name ||
							r.emoji === reaction.emoji.toString()
					);
					if (role) {
						foundGroup = group;
						foundRole = role;
						break;
					}
				}
			}

			if (!foundGroup || !foundRole) return;

			if (foundGroup.selectionMode === "exclusive") {
				// Exclusive roles cannot be toggled off by removing the reaction.
				// Keep the role and ensure the bot's reaction remains available.
				const guild = reaction.message.guild;
				const member = await guild.members.fetch(user.id).catch(() => null);
				if (member && member.roles.cache.has(foundRole.roleId)) {
					await reaction.message.react(reaction.emoji.id || reaction.emoji.name).catch(() => null);
				}
				return;
			}

			const guild = reaction.message.guild;
			const member = await guild.members.fetch(user.id).catch(() => null);
			if (!member) return;

			const botMember = await guild.members.fetchMe();
			if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) return;

			const role = guild.roles.cache.get(foundRole.roleId);
			if (!canManageRole(role, guild, botMember)) return;

			if (member.roles.cache.has(role.id)) {
				await member.roles.remove(role.id);
				await recordSelection(Selection, guild.id, member.id, foundGroup, role.id, "remove", reaction.message.id);
			}
		} catch (err) {
			ctx.logger.error("Error in messageReactionRemove event handler:", err);
		}
	});

	ctx.logger.info("Reaction Roles plugin loaded");
}

module.exports = { load };
