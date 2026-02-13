/**
 * Nicknames Everywhere - Kettu/Bunny Plugin
 * By: [Your Name]
 * 
 * Set custom nicknames for any user that persist across all servers and DMs.
 * Mobile-optimized with proper cleanup and patching patterns.
 */

import { logger } from "@vendetta";
import { findByProps, findByStoreName } from "@vendetta/metro";
import { before, after } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { React, ReactNative as RN } from "@vendetta/metro/common";
import { showInputAlert, showConfirmationAlert } from "@vendetta/ui/alerts";
import { useProxy } from "@vendetta/storage";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { Forms } from "@vendetta/ui/components";

const { ScrollView, View, Text, TouchableOpacity, TextInput } = RN;
const { FormRow, FormSwitch, FormInput, FormDivider, FormSection, FormText } = Forms;

// Storage initialization
if (!storage.nicknames) storage.nicknames = {};
if (!storage.settings) {
    storage.settings = {
        enabled: true,
        showPrefix: false,
        prefix: "[",
        suffix: "]",
        overrideServerNicks: true,
    };
}

// Cleanup references
let unpatches: (() => void)[] = [];
let origGetName: Function | null = null;
let origGetDisplayName: Function | null = null;
let origGetNick: Function | null = null;
let UserUtilsModule: any = null;
let GuildMemberStoreModule: any = null;

// Helper functions
function getNickname(userId: string): string | null {
    if (!storage.settings.enabled || !userId) return null;
    const nickname = storage.nicknames[userId];
    if (!nickname) return null;
    
    if (storage.settings.showPrefix) {
        return storage.settings.prefix + nickname + storage.settings.suffix;
    }
    return nickname;
}

function setNickname(userId: string, nickname: string) {
    if (!nickname || nickname.trim() === "") {
        delete storage.nicknames[userId];
    } else {
        storage.nicknames[userId] = nickname.trim();
    }
}

function showToast(message: string, type: number = 1) {
    const ToastModule = findByProps("showToast");
    if (ToastModule?.showToast) {
        ToastModule.showToast(message, type);
    }
}

function promptSetNickname(userId: string, currentName: string) {
    const currentNickname = storage.nicknames[userId] || "";
    
    showInputAlert({
        title: "Set Custom Nickname",
        placeholder: currentName,
        initialValue: currentNickname,
        confirmText: "Save",
        cancelText: "Cancel",
        onConfirm: (value: string) => {
            setNickname(userId, value);
            if (value.trim()) {
                showToast(`Nickname set to "${value}"`);
            } else {
                showToast("Nickname removed");
            }
        }
    });
}

// Patching functions
function patchUserUtils() {
    try {
        UserUtilsModule = findByProps("getUser", "getCurrentUser");
        
        if (!UserUtilsModule) {
            logger.warn("[NicknamesEverywhere] UserUtils module not found");
            return;
        }

        // Save originals for cleanup
        if (UserUtilsModule.getName) {
            origGetName = UserUtilsModule.getName;
            
            UserUtilsModule.getName = function(...args: any[]) {
                const user = args[0];
                if (user?.id) {
                    const nick = getNickname(user.id);
                    if (nick) return nick;
                }
                return (origGetName as Function).apply(this, args);
            };
        }

        if (UserUtilsModule.getDisplayName) {
            origGetDisplayName = UserUtilsModule.getDisplayName;
            
            UserUtilsModule.getDisplayName = function(...args: any[]) {
                const user = args[0];
                if (user?.id) {
                    const nick = getNickname(user.id);
                    if (nick) return nick;
                }
                return (origGetDisplayName as Function).apply(this, args);
            };
        }

        logger.log("[NicknamesEverywhere] UserUtils patched (getName, getDisplayName)");
    } catch (e) {
        logger.error("[NicknamesEverywhere] Error patching UserUtils:", e);
    }
}

function patchGuildMemberStore() {
    try {
        GuildMemberStoreModule = findByProps("getNick", "getMember");
        
        if (!GuildMemberStoreModule || !GuildMemberStoreModule.getNick) {
            logger.warn("[NicknamesEverywhere] GuildMemberStore.getNick not found");
            return;
        }

        if (!storage.settings.overrideServerNicks) {
            logger.log("[NicknamesEverywhere] Server nickname override disabled");
            return;
        }

        origGetNick = GuildMemberStoreModule.getNick;
        
        GuildMemberStoreModule.getNick = function(...args: any[]) {
            const userId = args[1]; // getNick(guildId, userId)
            if (userId) {
                const nick = getNickname(userId);
                if (nick) return nick;
            }
            return (origGetNick as Function).apply(this, args);
        };

        logger.log("[NicknamesEverywhere] GuildMemberStore.getNick patched");
    } catch (e) {
        logger.error("[NicknamesEverywhere] Error patching GuildMemberStore:", e);
    }
}

function patchUserActions() {
    try {
        // The profile action sheet uses a LazyActionSheet pattern
        // We need to find the function that builds the action items array
        const actionModules = [
            findByProps("openUserContextMenu"),
            findByProps("showUserActionSheet"),
            findByProps("openContextMenuLazy"),
            findByProps("openUserContextMenuForUser"),
        ].filter(Boolean);

        if (actionModules.length === 0) {
            logger.warn("[NicknamesEverywhere] No user action modules found");
            return;
        }

        let patched = false;

        for (const mod of actionModules) {
            // Try patching the main action sheet opener
            if (typeof mod.openUserContextMenu === "function") {
                try {
                    const unpatch = before("openUserContextMenu", mod, (args) => {
                        // args typically contains user info and a callback
                        // We'll inject into the callback's result
                    });
                    unpatches.push(unpatch);
                    patched = true;
                } catch (e) {}
            }

            // Also try direct action getters
            const funcNames = ["getUserActions", "getActions", "buildUserContextMenuItems", "getUserContextMenuItems"];
            
            for (const fname of funcNames) {
                if (typeof mod[fname] === "function") {
                    try {
                        const unpatch = after(fname, mod, (args, actions) => {
                            if (!Array.isArray(actions)) return actions;
                            
                            // Extract user from various possible argument patterns
                            const user = args[0]?.user || args[0]?.userId || args[0];
                            let userId = null;
                            
                            if (typeof user === "string") {
                                userId = user;
                            } else if (user?.id) {
                                userId = user.id;
                            }
                            
                            if (!userId) return actions;
                            
                            const currentNick = storage.nicknames[userId];
                            const displayName = user?.globalName || user?.username || "User";
                            
                            // Find the position to insert (after "Add Friend Nickname" or before "Block")
                            let insertIndex = actions.findIndex(a => 
                                a?.label?.includes("Block") || 
                                a?.key === "block" ||
                                a?.label?.includes("Ignore")
                            );
                            
                            if (insertIndex === -1) {
                                insertIndex = actions.length;
                            }
                            
                            // Create our nickname actions
                            const nicknameActions = [];
                            
                            // Set/Edit Nickname button
                            nicknameActions.push({
                                key: "set-custom-nickname",
                                label: currentNick ? "Edit Custom Nickname" : "Set Custom Nickname",
                                icon: "ic_edit",
                                onPress: () => promptSetNickname(userId, displayName)
                            });
                            
                            // Remove Nickname button (only if exists)
                            if (currentNick) {
                                nicknameActions.push({
                                    key: "remove-custom-nickname",
                                    label: "Remove Custom Nickname",
                                    icon: "ic_message_delete",
                                    destructive: true,
                                    onPress: () => {
                                        setNickname(userId, "");
                                        showToast("Custom nickname removed");
                                    }
                                });
                            }
                            
                            // Insert before Block button
                            actions.splice(insertIndex, 0, ...nicknameActions);
                            
                            return actions;
                        });
                        
                        unpatches.push(unpatch);
                        patched = true;
                        logger.log(`[NicknamesEverywhere] Patched ${fname}`);
                    } catch (e) {
                        // Try next function
                    }
                }
            }
        }

        if (!patched) {
            logger.warn("[NicknamesEverywhere] Could not patch user action menu");
        }
    } catch (e) {
        logger.error("[NicknamesEverywhere] Error patching user actions:", e);
    }
}

// Settings Component
function SettingsPage() {
    useProxy(storage);
    const UserStore = findByStoreName("UserStore");
    const [searchQuery, setSearchQuery] = React.useState("");

    const getUserInfo = (userId: string) => {
        try {
            const user = UserStore?.getUser(userId);
            return user ? user.username : userId;
        } catch {
            return userId;
        }
    };

    const filteredNicknames = Object.entries(storage.nicknames).filter(([userId, nickname]) => {
        if (!searchQuery) return true;
        const userInfo = getUserInfo(userId).toLowerCase();
        const nickLower = (nickname as string).toLowerCase();
        const queryLower = searchQuery.toLowerCase();
        return userInfo.includes(queryLower) || nickLower.includes(queryLower);
    });

    return React.createElement(
        ScrollView,
        { style: { flex: 1 } },
        React.createElement(
            FormSection,
            { title: "General Settings" },
            React.createElement(FormRow, {
                label: "Enable Nicknames",
                subLabel: "Toggle all nickname functionality",
                trailing: React.createElement(FormSwitch, {
                    value: storage.settings.enabled,
                    onValueChange: (v: boolean) => { storage.settings.enabled = v; }
                })
            }),
            React.createElement(FormRow, {
                label: "Override Server Nicknames",
                subLabel: "Use custom nicknames instead of server ones",
                trailing: React.createElement(FormSwitch, {
                    value: storage.settings.overrideServerNicks,
                    onValueChange: (v: boolean) => { 
                        storage.settings.overrideServerNicks = v;
                        // Re-patch if enabling
                        if (v && !origGetNick) {
                            patchGuildMemberStore();
                        }
                    }
                })
            })
        ),
        React.createElement(FormDivider, null),
        React.createElement(
            FormSection,
            { title: "Display Options" },
            React.createElement(FormRow, {
                label: "Show Prefix/Suffix",
                subLabel: "Add decorative text around nicknames",
                trailing: React.createElement(FormSwitch, {
                    value: storage.settings.showPrefix,
                    onValueChange: (v: boolean) => { storage.settings.showPrefix = v; }
                })
            }),
            storage.settings.showPrefix && React.createElement(FormInput, {
                label: "Prefix",
                placeholder: "[",
                value: storage.settings.prefix,
                onChange: (v: string) => { storage.settings.prefix = v; }
            }),
            storage.settings.showPrefix && React.createElement(FormInput, {
                label: "Suffix",
                placeholder: "]",
                value: storage.settings.suffix,
                onChange: (v: string) => { storage.settings.suffix = v; }
            }),
            storage.settings.showPrefix && React.createElement(
                View,
                { style: { padding: 16, backgroundColor: "#2b2d31", marginHorizontal: 16, marginTop: 8, borderRadius: 8 } },
                React.createElement(Text, {
                    style: { color: "#b5bac1", fontSize: 13 }
                }, `Preview: ${storage.settings.prefix}YourNickname${storage.settings.suffix}`)
            )
        ),
        React.createElement(FormDivider, null),
        React.createElement(
            FormSection,
            { title: `Saved Nicknames (${Object.keys(storage.nicknames).length})` },
            React.createElement(FormText, null, "Long-press any user to set a nickname"),
            React.createElement(
                View,
                { style: { padding: 16 } },
                React.createElement(TextInput, {
                    placeholder: "Search nicknames...",
                    placeholderTextColor: "#666",
                    value: searchQuery,
                    onChangeText: setSearchQuery,
                    style: {
                        backgroundColor: "#1e1f22",
                        color: "#fff",
                        padding: 12,
                        borderRadius: 8,
                        marginBottom: 12
                    }
                }),
                filteredNicknames.length === 0 ? React.createElement(
                    View,
                    { style: { padding: 20, alignItems: "center" } },
                    React.createElement(Text, {
                        style: { color: "#888", textAlign: "center" }
                    }, searchQuery ? "No nicknames found" : "No nicknames saved yet")
                ) : filteredNicknames.map(([userId, nickname]) => 
                    React.createElement(
                        View,
                        {
                            key: userId,
                            style: {
                                backgroundColor: "#2b2d31",
                                padding: 12,
                                borderRadius: 8,
                                marginBottom: 8
                            }
                        },
                        React.createElement(Text, {
                            style: { color: "#fff", fontWeight: "bold", marginBottom: 4 }
                        }, nickname as string),
                        React.createElement(Text, {
                            style: { color: "#888", fontSize: 12, marginBottom: 8 }
                        }, getUserInfo(userId)),
                        React.createElement(
                            View,
                            { style: { flexDirection: "row", gap: 8 } },
                            React.createElement(
                                TouchableOpacity,
                                {
                                    style: {
                                        backgroundColor: "#5865f2",
                                        padding: 8,
                                        borderRadius: 6,
                                        flex: 1
                                    },
                                    onPress: () => promptSetNickname(userId, getUserInfo(userId))
                                },
                                React.createElement(Text, {
                                    style: { color: "#fff", textAlign: "center", fontSize: 12, fontWeight: "600" }
                                }, "Edit")
                            ),
                            React.createElement(
                                TouchableOpacity,
                                {
                                    style: {
                                        backgroundColor: "#ed4245",
                                        padding: 8,
                                        borderRadius: 6,
                                        flex: 1
                                    },
                                    onPress: () => {
                                        setNickname(userId, "");
                                        showToast("Nickname removed");
                                    }
                                },
                                React.createElement(Text, {
                                    style: { color: "#fff", textAlign: "center", fontSize: 12, fontWeight: "600" }
                                }, "Delete")
                            )
                        )
                    )
                )
            )
        ),
        React.createElement(FormDivider, null),
        React.createElement(
            FormSection,
            { title: "Data Management" },
            React.createElement(FormRow, {
                label: "Export Nicknames",
                subLabel: "Copy to clipboard as JSON",
                leading: React.createElement(FormRow.Icon, {
                    source: getAssetIDByName("ic_download_24px")
                }),
                onPress: () => {
                    const json = JSON.stringify(storage.nicknames, null, 2);
                    RN.Clipboard?.setString(json);
                    showToast(`Exported ${Object.keys(storage.nicknames).length} nicknames`);
                }
            }),
            React.createElement(FormRow, {
                label: "Import Nicknames",
                subLabel: "Paste JSON from clipboard",
                leading: React.createElement(FormRow.Icon, {
                    source: getAssetIDByName("ic_upload_24px")
                }),
                onPress: async () => {
                    try {
                        const clipboard = await RN.Clipboard?.getString();
                        if (!clipboard) {
                            showToast("Clipboard is empty", 2);
                            return;
                        }
                        
                        const parsed = JSON.parse(clipboard);
                        Object.assign(storage.nicknames, parsed);
                        showToast(`Imported ${Object.keys(parsed).length} nicknames`);
                    } catch (e) {
                        showToast("Invalid JSON format", 2);
                    }
                }
            }),
            React.createElement(FormRow, {
                label: "Clear All Nicknames",
                subLabel: "Delete all saved nicknames",
                leading: React.createElement(FormRow.Icon, {
                    source: getAssetIDByName("ic_message_delete")
                }),
                onPress: () => {
                    showConfirmationAlert({
                        title: "Clear All Nicknames?",
                        content: `Delete all ${Object.keys(storage.nicknames).length} saved nicknames?`,
                        confirmText: "Delete All",
                        cancelText: "Cancel",
                        confirmColor: "red",
                        onConfirm: () => {
                            const count = Object.keys(storage.nicknames).length;
                            storage.nicknames = {};
                            showToast(`Cleared ${count} nicknames`);
                        }
                    });
                }
            })
        ),
        React.createElement(
            View,
            { style: { padding: 16, marginBottom: 20 } },
            React.createElement(Text, {
                style: { color: "#b5bac1", fontSize: 12, textAlign: "center", lineHeight: 18 }
            }, "Nicknames Everywhere v1.0\nCustom nicknames across all servers and DMs")
        )
    );
}

// Plugin export
export default {
    onLoad: () => {
        try {
            patchUserUtils();
            patchGuildMemberStore();
            patchUserActions();
            
            logger.log(`[NicknamesEverywhere] Loaded with ${Object.keys(storage.nicknames).length} nicknames`);
        } catch (e) {
            logger.error("[NicknamesEverywhere] Load error:", e);
        }
    },

    onUnload: () => {
        // Restore UserUtils
        if (UserUtilsModule) {
            if (origGetName) {
                UserUtilsModule.getName = origGetName;
                origGetName = null;
            }
            if (origGetDisplayName) {
                UserUtilsModule.getDisplayName = origGetDisplayName;
                origGetDisplayName = null;
            }
            UserUtilsModule = null;
        }

        // Restore GuildMemberStore
        if (GuildMemberStoreModule && origGetNick) {
            GuildMemberStoreModule.getNick = origGetNick;
            origGetNick = null;
            GuildMemberStoreModule = null;
        }

        // Unpatch user actions
        unpatches.forEach(fn => {
            try {
                fn();
            } catch (e) {
                logger.error("[NicknamesEverywhere] Unpatch error:", e);
            }
        });
        unpatches = [];

        logger.log("[NicknamesEverywhere] Unloaded. All patches restored.");
    },
    
    settings: SettingsPage
};
