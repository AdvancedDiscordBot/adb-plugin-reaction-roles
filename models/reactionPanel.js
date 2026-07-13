const { Schema } = require("mongoose");

const reactionRoleSchema = new Schema({
	roleId: { type: String, required: true },
	emoji: { type: String }, // Unicode emoji or custom emoji string/id
	label: { type: String }, // Display label for buttons or select menu options
	description: { type: String }, // Description for select menu options
});

const groupSchema = new Schema({
	name: { type: String, required: true }, // Internal identifier for the group (slug)
	label: { type: String, required: true }, // User-facing display title/header of the group
	description: { type: String }, // Description for the group
	type: { type: String, enum: ["emoji", "button", "dropdown"], default: "dropdown" },
	selectionMode: { type: String, enum: ["single", "multiple", "exclusive"], default: "multiple" },
	roles: [reactionRoleSchema],
});

const reactionPanelSchema = new Schema({
	guildId: { type: String, required: true, index: true },
	channelId: { type: String, required: true },
	messageId: { type: String, required: true, unique: true, index: true },
	title: { type: String, required: true },
	description: { type: String },
	color: { type: String, default: "#5865F2" }, // Hex color for embed
	groups: [groupSchema],
	createdAt: { type: Date, default: Date.now },
});

module.exports = reactionPanelSchema;
