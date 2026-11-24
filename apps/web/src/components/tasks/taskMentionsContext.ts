import { createContext } from "react";

/** True inside the planning chat, where the composer's @ menu also lists the board's tasks. */
export const TaskMentionsContext = createContext(false);
