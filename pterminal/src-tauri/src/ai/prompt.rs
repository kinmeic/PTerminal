use crate::ai::ChatMessage;

/// Build the system + user message pair for a general assistant chat turn.
/// `terminal_context` is an optional snapshot of recent terminal output that
/// gives the assistant visibility into what the user is seeing (errors, logs).
pub fn chat_messages(
    history: &[ChatMessage],
    user_text: &str,
    cwd: &str,
    terminal_context: Option<&str>,
) -> Vec<ChatMessage> {
    let context_block = match terminal_context {
        Some(c) if !c.trim().is_empty() => format!(
            "\n\nThe user's most recent terminal output is shown below. Use it to \
             understand what they're working on, but do not assume they are asking \
             about it unless their message references it.\n\n```\n{c}\n```"
        ),
        _ => String::new(),
    };
    let mut msgs = vec![ChatMessage {
        role: "system".to_string(),
        content: format!(
            "You are PTerminal, a helpful assistant embedded in a macOS terminal app. \
             The user is working in the directory: {cwd}.{context_block} \
             Answer concisely. When suggesting shell commands, wrap them in a single \
             fenced code block labelled ```sh so they can be extracted. Respond in the \
             same language the user writes in."
        ),
    }];
    msgs.extend_from_slice(history);
    msgs.push(ChatMessage {
        role: "user".to_string(),
        content: user_text.to_string(),
    });
    msgs
}

/// Natural-language → shell command. Output must be a raw command (no prose).
pub fn suggest_messages(prompt: &str, cwd: &str) -> Vec<ChatMessage> {
    vec![
        ChatMessage {
            role: "system".to_string(),
            content: format!(
                "You convert natural-language requests into a single macOS/zsh shell command. \
                 Working directory: {cwd}. \
                 Reply with ONLY the command — no explanation, no markdown fences, no backticks. \
                 If the request is ambiguous, pick the most reasonable interpretation."
            ),
        },
        ChatMessage {
            role: "user".to_string(),
            content: prompt.to_string(),
        },
    ]
}

/// Explain terminal output in plain language.
pub fn explain_messages(output: &str, cwd: &str) -> Vec<ChatMessage> {
    vec![
        ChatMessage {
            role: "system".to_string(),
            content: format!(
                "You explain terminal output clearly in the user's language. \
                 Working directory: {cwd}. Keep explanations short and structured. \
                 If the output indicates an error, explain the cause and suggest a fix."
            ),
        },
        ChatMessage {
            role: "user".to_string(),
            content: format!("Explain this terminal output:\n\n```\n{output}\n```"),
        },
    ]
}

/// Diagnose a failed command's output and propose a fix.
pub fn diagnose_messages(output: &str, cwd: &str) -> Vec<ChatMessage> {
    vec![
        ChatMessage {
            role: "system".to_string(),
            content: format!(
                "You diagnose shell command errors. Working directory: {cwd}. \
                 Identify the root cause, then give the corrected command in a ```sh block. \
                 Be concise."
            ),
        },
        ChatMessage {
            role: "user".to_string(),
            content: format!("This command failed:\n\n```\n{output}\n```\n\nWhat went wrong and how do I fix it?"),
        },
    ]
}
