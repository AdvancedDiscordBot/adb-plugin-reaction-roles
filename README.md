# adb-plugin-reaction-roles

Reaction roles plugin for [Advanced Discord Bot](https://github.com/AdvancedDiscordBot/Advanced-Discord-Bot) (ADB).

Allows server administrators to create premium reaction role panels via slash commands with buttons, select menus, and emoji reactions.

## Features

- **Multiple Selection Modes**: Supports single (max 1), multiple (any options in the group), and exclusive (cannot deselect the last role) selection modes per role group.
- **Modern Message Components**: Utilizes modern Discord buttons and dropdown select menus, as well as traditional emoji reactions.
- **Grouping**: Group roles with labels and descriptions inside a single panel message (up to 5 groups within Discord's action-row limits).
- **Auto-recreation / Refresh**: Recreate or sync the panel message instantly using the `/reactionrole refresh` command.
- **MongoDB Backend**: Persists panel configurations per guild.

## Installation

Add it to your Advanced Discord Bot plugins:

```bash
npm install adb-plugin-reaction-roles
```

## Runtime trust

This plugin declares `system:raw-client` in both `capabilities` and `permissions`
and a persistent process, using the same explicit direct-loading contract as
moderation. It needs live Discord.js guilds, members, messages, components and
reaction events. Do not disable global plugin isolation to run it.

Owner approval grants elevated host trust: execution in the bot's main process
with raw client, host database and environment access. The narrower permission
lists are not sandbox boundaries, and ADB's platform per-guild enable toggle does
not apply to raw-client plugins. Only install code the bot owner trusts.

Selections are checked against the persisted guild, channel, current message,
group type and role options before role changes. Managed roles, `@everyone`, and
roles at or above the bot's highest role cannot be selected or displaced.

Panels support at most 5 groups and 5 action rows total. Each dropdown supports
25 options; each button row holds 5 buttons. Messages support 20 emoji reactions.
Discord's embed and 100-character component ID limits are validated before saving
panel additions. Group names cannot contain colons. Refreshing a deleted panel
rebuilds its components with the replacement message ID.

## Slash Commands

| Command | Subcommand | Description |
|---|---|---|
| `/reactionrole` | `create` | Create a new reaction role panel message in a channel |
| `/reactionrole` | `add` | Add a role option to a reaction role panel |
| `/reactionrole` | `remove` | Remove a role option from a reaction role panel |
| `/reactionrole` | `delete` | Delete a reaction role panel completely |
| `/reactionrole` | `list` | List all reaction role panels in this server |
| `/reactionrole` | `refresh` | Sync or recreate a panel's message content and reactions |

## Local Testing

Run offline unit and integration tests against a mock PluginContext using:

```bash
npm test
```

## License

This project is licensed under the **GNU Affero General Public License v3.0**. See the [LICENSE](LICENSE) file for details.
