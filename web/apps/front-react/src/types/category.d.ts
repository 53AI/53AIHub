declare namespace Category {
  interface State {
    group_id: number
    eid: number
    created_by: number
    group_name: string
    group_type: number
    sort: number
    agents: any
    created_time: number
    updated_time: number
    visible?: boolean
  }
}
