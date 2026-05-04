return items.map(item => ({
  json: {
    ...item.json,
    sheet_memory_record_type: 'existing_sheet_row',
  },
}));
