import * as moment from '@/utils/moment'

export const dateRangeOptions: { value: string; label: string }[] = [
  {
    value: '0',
    label: window.$t('filter.date_range.today')
  },
  {
    value: '1',
    label: window.$t('filter.date_range.last_7_days')
  },
  {
    value: '2',
    label: window.$t('filter.date_range.last_4_weeks')
  },
  {
    value: '3',
    label: window.$t('filter.date_range.last_3_months')
  },
  {
    value: '4',
    label: window.$t('filter.date_range.last_12_months')
  },
  {
    value: '5',
    label: window.$t('filter.date_range.this_month')
  },
  {
    value: '6',
    label: window.$t('filter.date_range.this_quarter')
  },
  {
    value: '7',
    label: window.$t('filter.date_range.this_year')
  },
  {
    value: '8',
    label: window.$t('filter.date_range.all_time')
  }
]

export const getRangeStartEndDates = (time_type: string): { start?: string; end?: string } => {
  const options = {}
  let start = ''
  if (time_type === '0') start = moment.getCurrentDate('YYYY-MM-DD 00:01')
  else if (time_type === '1') start = moment.getLastTimeAsDay(7, 'YYYY-MM-DD hh:mm')
  else if (time_type === '2') start = moment.getLastTimeAsWeek(4, 'YYYY-MM-DD hh:mm')
  else if (time_type === '3') start = moment.getLastTimeAsMonth(3, 'YYYY-MM-DD hh:mm')
  else if (time_type === '4') start = moment.getLastTimeAsMonth(12, 'YYYY-MM-DD hh:mm')
  else if (time_type === '5') start = moment.getCurrentMonth('YYYY-MM-DD hh:mm')
  else if (time_type === '6') start = moment.getCurrentQuarter('YYYY-MM-DD hh:mm')
  else if (time_type === '7') start = moment.getCurrentYeaer('YYYY-MM-DD hh:mm')
  else if (time_type === '8') start = '2022-01-01 00:00'

  if (start) {
    options.start = start
    options.end = moment.getCurrentDate('YYYY-MM-DD hh:mm')
  } else {
    options.start = null
    options.end = null
  }

  return options
}
