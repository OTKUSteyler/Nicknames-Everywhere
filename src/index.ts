/**
 * Nicknames Everywhere — Kettu/Bunny Plugin
 * Mobile-optimized version
 */

import { findByProps, findByStoreName } from "@vendetta/metro";
import { after } from "@vendetta/patcher";
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

let unpatches = [];

// Helper functions
function getNickname(userId) {
    if (!storage.settings.enabled || !userId) return null;
    const nickname = storage.nicknames[userId];
    if (!nickname) return null;
    
    if (storage.settings.showPrefix) {
        return storage.settings.prefix + nickname + storage.settings.suffix;
    }
    return nickname;
}

function setNickname(userId, nickname) {
    if (!nickname || nickname.trim() === "") {
        delete storage.nicknames[userId];
    } else {
        storage.nicknames[userId] = nickname.trim();
    }
}

function promptSetNickname(userId, currentName) {
    const currentNickname = storage.nicknames[userId] || "";
    
    showInputAlert({
        title: "Set Custom Nickname",
        placeholder: currentName,
        initialValue: currentNickname,
        confirmText: "Save",
        cancelText: "Cancel",
        onConfirm: (value) => {
            setNickname(userId, value);
            const ToastModule = findByProps("showToast");
            if (ToastModule?.showToast) {
                if (value.trim()) {
                    ToastModule.showToast("Nickname saved", 1);
                } else {
                    ToastModule.showToast("Nickname removed", 1);
                }
            }
        }
    });
}

// Patching functions
function patchGetName() {
    try {
        const UserUtils = findByProps("getUser", "getCurrentUser");
        
        if (UserUtils?.getName) {
            unpatches.push(after("getName", UserUtils, (args, ret) => {
                const user = args[0];
                if (user?.id) {
                    const nick = getNickname(user.id);
                    if (nick) return nick;
                }
                return ret;
            }));
        }

        if (UserUtils?.getDisplayName) {
            unpatches.push(after("getDisplayName", UserUtils, (args, ret) => {
                const user = args[0];
                if (user?.id) {
                    const nick = getNickname(user.id);
                    if (nick) return nick;
                }
                return ret;
            }));
        }
    } catch (e) {
        console.error("[NicknamesEverywhere] Error patching UserUtils:", e);
    }
}

function patchMemberStore() {
    try {
        const GuildMemberStore = findByProps("getNick", "getMember");
        
        if (GuildMemberStore?.getNick && storage.settings.overrideServerNicks) {
            unpatches.push(after("getNick", GuildMemberStore, (args, ret) => {
                const userId = args[1];
                if (userId) {
                    const nick = getNickname(userId);
                    if (nick) return nick;
                }
                return ret;
            }));
        }
    } catch (e) {
        console.error("[NicknamesEverywhere] Error patching GuildMemberStore:", e);
    }
}

function patchUserActions() {
    try {
        // Try to find user action modules
        const actionModules = [
            findByProps("openUserContextMenu"),
            findByProps("showUserActionSheet"),
        ].filter(Boolean);

        for (const mod of actionModules) {
            const funcNames = ["getUserActions", "getActions"];
            
            for (const fname of funcNames) {
                if (typeof mod[fname] === "function") {
                    try {
                        unpatches.push(after(fname, mod, (args, actions) => {
                            if (!Array.isArray(actions)) return actions;
                            
                            const user = args[0]?.user || args[0];
                            if (!user?.id) return actions;
                            
                            const currentNick = storage.nicknames[user.id];
                            const displayName = user.globalName || user.username || "User";
                            
                            // Add Set/Edit Nickname option
                            actions.push({
                                key: "set-nickname",
                                label: currentNick ? "Edit Nickname" : "Set Nickname",
                                icon: "ic_edit",
                                onPress: () => promptSetNickname(user.id, displayName)
                            });
                            
                            // Add Remove option if nickname exists
                            if (currentNick) {
                                actions.push({
                                    key: "remove-nickname",
                                    label: "Remove Nickname",
                                    icon: "ic_message_delete",
                                    destructive: true,
                                    onPress: () => {
                                        setNickname(user.id, "");
                                        const ToastModule = findByProps("showToast");
                                        if (ToastModule?.showToast) {
                                            ToastModule.showToast("Nickname removed", 1);
                                        }
                                    }
                                });
                            }
                            
                            return actions;
                        }));
                    } catch (e) {}
                }
            }
        }
    } catch (e) {
        console.error("[NicknamesEverywhere] Error patching user actions:", e);
    }
}

// Settings Component
function SettingsPage() {
    useProxy(storage);
    const UserStore = findByStoreName("UserStore");
    const [searchQuery, setSearchQuery] = React.useState("");

    const getUserInfo = (userId) => {
        try {
            const user = UserStore?.getUser(userId);
            return user ? `${user.username}` : userId;
        } catch {
            return userId;
        }
    };

    const filteredNicknames = Object.entries(storage.nicknames).filter(([userId, nickname]) => {
        if (!searchQuery) return true;
        const userInfo = getUserInfo(userId).toLowerCase();
        const nickLower = nickname.toLowerCase();
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
                subLabel: "Toggle nickname functionality",
                trailing: React.createElement(FormSwitch, {
                    value: storage.settings.enabled,
                    onValueChange: (v) => { storage.settings.enabled = v; }
                })
            }),
            React.createElement(FormRow, {
                label: "Override Server Nicknames",
                subLabel: "Use custom nicknames instead of server ones",
                trailing: React.createElement(FormSwitch, {
                    value: storage.settings.overrideServerNicks,
                    onValueChange: (v) => { storage.settings.overrideServerNicks = v; }
                })
            })
        ),
        React.createElement(FormDivider, null),
        React.createElement(
            FormSection,
            { title: "Display Options" },
            React.createElement(FormRow, {
                label: "Show Prefix/Suffix",
                subLabel: "Add text around nicknames",
                trailing: React.createElement(FormSwitch, {
                    value: storage.settings.showPrefix,
                    onValueChange: (v) => { storage.settings.showPrefix = v; }
                })
            }),
            storage.settings.showPrefix && React.createElement(FormInput, {
                label: "Prefix",
                placeholder: "[",
                value: storage.settings.prefix,
                onChange: (v) => { storage.settings.prefix = v; }
            }),
            storage.settings.showPrefix && React.createElement(FormInput, {
                label: "Suffix",
                placeholder: "]",
                value: storage.settings.suffix,
                onChange: (v) => { storage.settings.suffix = v; }
            })
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
                        }, nickname),
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
                                    style: { color: "#fff", textAlign: "center", fontSize: 12 }
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
                                        const ToastModule = findByProps("showToast");
                                        if (ToastModule?.showToast) {
                                            ToastModule.showToast("Nickname removed", 1);
                                        }
                                    }
                                },
                                React.createElement(Text, {
                                    style: { color: "#fff", textAlign: "center", fontSize: 12 }
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
                    const ToastModule = findByProps("showToast");
                    if (ToastModule?.showToast) {
                        ToastModule.showToast(`Exported ${Object.keys(storage.nicknames).length} nicknames`, 1);
                    }
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
                            const ToastModule = findByProps("showToast");
                            if (ToastModule?.showToast) {
                                ToastModule.showToast("Clipboard is empty", 2);
                            }
                            return;
                        }
                        
                        const parsed = JSON.parse(clipboard);
                        Object.assign(storage.nicknames, parsed);
                        const ToastModule = findByProps("showToast");
                        if (ToastModule?.showToast) {
                            ToastModule.showToast(`Imported ${Object.keys(parsed).length} nicknames`, 1);
                        }
                    } catch (e) {
                        const ToastModule = findByProps("showToast");
                        if (ToastModule?.showToast) {
                            ToastModule.showToast("Invalid JSON format", 2);
                        }
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
                            const ToastModule = findByProps("showToast");
                            if (ToastModule?.showToast) {
                                ToastModule.showToast(`Cleared ${count} nicknames`, 1);
                            }
                        }
                    });
                }
            })
        ),
        React.createElement(
            View,
            { style: { padding: 16, marginBottom: 20 } },
            React.createElement(Text, {
                style: { color: "#b5bac1", fontSize: 12, textAlign: "center" }
            }, "Nicknames Everywhere v1.0")
        )
    );
}

// Plugin export
export default {
    onLoad: () => {
        try {
            patchGetName();
            patchMemberStore();
            patchUserActions();
            
            console.log(`[NicknamesEverywhere] Loaded with ${Object.keys(storage.nicknames).length} nicknames`);
        } catch (e) {
            console.error("[NicknamesEverywhere] Load error:", e);
        }
    },

    onUnload: () => {
        unpatches.forEach(fn => {
            try {
                fn();
            } catch (e) {}
        });
        unpatches = [];
        console.log("[NicknamesEverywhere] Unloaded");
    },
    
    settings: SettingsPage
};
