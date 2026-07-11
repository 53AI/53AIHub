import { create } from 'zustand'
import { generateRandomId } from '@km/shared-utils/universal'

export type TodoItem = {
  id: string
  title: string
  done: boolean
}

type TodoState = {
  items: TodoItem[]
  addTodo: (title: string) => void
  toggleTodo: (id: string) => void
  removeTodo: (id: string) => void
}

export const useTodoStore = create<TodoState>((set) => ({
  items: [],

  addTodo: (title: string) =>
    set((state) => ({
      items: [
        ...state.items,
        { id: generateRandomId(8), title: title.trim(), done: false },
      ],
    })),

  toggleTodo: (id: string) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id ? { ...item, done: !item.done } : item
      ),
    })),

  removeTodo: (id: string) =>
    set((state) => ({
      items: state.items.filter((item) => item.id !== id),
    })),
}))
