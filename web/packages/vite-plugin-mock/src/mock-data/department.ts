import type { MockRoute } from '../router'

const ok = (data: any) => ({ code: 0, message: 'ok', data })
const now = Math.floor(Date.now() / 1000)

const mockDepartments = [
  {
    did: 1,
    name: 'Headquarters',
    pdid: 0,
    path: '/1',
    eid: 1,
    sort: 0,
    from: 0,
    bind_value: '',
    created_time: now - 86400 * 60,
    updated_time: now,
    children: [
      {
        did: 2,
        name: 'Engineering',
        pdid: 1,
        path: '/1/2',
        eid: 1,
        sort: 0,
        from: 0,
        bind_value: '',
        created_time: now - 86400 * 30,
        updated_time: now,
        children: [],
      },
      {
        did: 3,
        name: 'Product',
        pdid: 1,
        path: '/1/3',
        eid: 1,
        sort: 1,
        from: 0,
        bind_value: '',
        created_time: now - 86400 * 30,
        updated_time: now,
        children: [],
      },
    ],
  },
]

export const departmentRoutes: MockRoute[] = [
  {
    method: 'GET', path: '/api/departments',
    handler: () => ok({ departments: mockDepartments, count: mockDepartments.length }),
  },
  {
    method: 'GET', path: '/api/departments/tree',
    handler: () => ok({ tree: mockDepartments }),
  },
  {
    method: 'GET', path: '/api/departments/children/{pdid}',
    handler: (_req, params) => {
      const pdid = parseInt(params.pdid)
      const dept = mockDepartments.find(d => d.did === pdid)
      return ok(dept?.children || [])
    },
  },
  {
    method: 'POST', path: '/api/departments',
    handler: (_req, _params, body) => ok({
      did: Date.now(),
      pdid: 0,
      path: '/',
      eid: 1,
      sort: 0,
      from: 0,
      bind_value: '',
      created_time: now,
      updated_time: now,
      ...body,
    }),
  },
  {
    method: 'GET', path: '/api/departments/{did}',
    handler: (_req, params) => {
      const did = parseInt(params.did)
      const findDept = (depts: any[]): any => {
        for (const d of depts) {
          if (d.did === did) return d
          if (d.children) {
            const found = findDept(d.children)
            if (found) return found
          }
        }
        return null
      }
      return ok(findDept(mockDepartments) || mockDepartments[0])
    },
  },
  {
    method: 'PUT', path: '/api/departments/{did}',
    handler: () => ok(null),
  },
  {
    method: 'DELETE', path: '/api/departments/{did}',
    handler: () => ok(null),
  },
  {
    method: 'POST', path: '/api/departments/bind-member',
    handler: () => ok(null),
  },
  {
    method: 'POST', path: '/api/departments/sync/{from}',
    handler: () => ok(null),
  },
]
