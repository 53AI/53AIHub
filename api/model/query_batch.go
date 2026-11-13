package model

// batchQuerySize caps IN (...) lists so a single statement's placeholder list
// does not grow with the number of rows in a space.
const batchQuerySize = 400

// forEachInt64Batch invokes visit for each chunk of ids, preserving order.
func forEachInt64Batch(ids []int64, visit func([]int64) error) error {
	for start := 0; start < len(ids); start += batchQuerySize {
		end := start + batchQuerySize
		if end > len(ids) {
			end = len(ids)
		}
		if err := visit(ids[start:end]); err != nil {
			return err
		}
	}
	return nil
}
