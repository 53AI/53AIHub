package model

import (
	"errors"
	"fmt"
	"strings"

	"gorm.io/gorm"
)

// Department source constants
const (
	DepartmentFromBackend  = 0 // Created from Backend
	DepartmentFromWecom    = 1 // Imported from WecomChat
	DepartmentFromDingtalk = 2 // Imported from DingTalk
)

// Department status constants
const (
	DepartmentStatusNormal   = 0 // Normal
	DepartmentStatusDisabled = 1 // Disabled
	DepartmentStatusDeleted  = 2 // Deleted
)

// Department sort default values
const (
	DepartmentSortDefault = 0  // Default sort
	DepartmentSortTop     = -1 // Top priority
)

// Department represents a department in the organization
type Department struct {
	DID       int64  `json:"did" gorm:"column:did;primaryKey;autoIncrement;comment:'Department ID'"`
	PDID      int64  `json:"pdid" gorm:"column:pdid;not null;default:0;comment:'Parent Department ID'"`
	EID       int64  `json:"eid" gorm:"column:eid;not null;default:0;comment:'Enterprise ID'"`
	Name      string `json:"name" gorm:"column:name;size:255;not null;default:'';comment:'Department Name'"`
	Path      string `json:"path" gorm:"column:path;size:512;not null;default:'';comment:'Department Path'"`
	Sort      int    `json:"sort" gorm:"column:sort;not null;default:0;comment:'Sort Order'"`
	From      int    `json:"from" gorm:"column:from;not null;default:0;comment:'Source: 0-Backend, 1-Enterprise WeChat'"`
	BindValue string `json:"bind_value" gorm:"column:bindvalue;size:255;not null;default:'';comment:'Source Platform Binding Value'"`
	BaseModel
}

// TableName specifies the table name for Department model
func (Department) TableName() string {
	return "departments"
}

// InitDepartmentTable initializes the department table
func InitDepartmentTable() error {
	// Check if table exists
	if DB.Migrator().HasTable(&Department{}) {
		return nil
	}

	// Create table
	err := DB.Migrator().CreateTable(&Department{})
	if err != nil {
		return fmt.Errorf("failed to create department table: %w", err)
	}

	// Create default root department for system
	rootDept := &Department{
		EID:  1, // System EID
		Name: "System Root Department",
		Sort: 0,
	}

	result := DB.Create(rootDept)
	if result.Error != nil {
		return fmt.Errorf("failed to create root department: %w", result.Error)
	}

	return nil
}

// CreateDepartment creates a new department
func CreateDepartment(dept *Department) error {
	if err := validateDepartment(dept); err != nil {
		return err
	}

	tx := DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	if err := tx.Create(dept).Error; err != nil {
		tx.Rollback()
		return err
	}

	if dept.PDID > 0 {
		var pDept Department
		if err := tx.Where("eid = ? AND did = ?", dept.EID, dept.PDID).First(&pDept).Error; err != nil {
			tx.Rollback()
			return fmt.Errorf("pdid: %w", err)
		}

		if pDept.Path != "" {
			dept.Path = fmt.Sprintf("%s,%d", pDept.Path, dept.DID)
		} else {
			dept.Path = fmt.Sprintf("%d", dept.DID)
		}
	} else {
		dept.Path = fmt.Sprintf("%d", dept.DID)
	}

	if err := tx.Model(dept).Updates(map[string]interface{}{
		"path":      dept.Path,
		"bindvalue": fmt.Sprintf("%d", dept.DID),
	}).Error; err != nil {
		tx.Rollback()
		return err
	}

	return tx.Commit().Error
}

// validateDepartment validates department fields
func validateDepartment(dept *Department) error {
	if dept == nil {
		return errors.New("department cannot be nil")
	}
	if dept.Name == "" {
		return errors.New("department name cannot be empty")
	}
	if dept.EID == 0 {
		return errors.New("enterprise ID (EID) cannot be empty")
	}
	return nil
}

// GetDepartmentByID retrieves a department by its ID and enterprise ID
func GetDepartmentByID(eid int64, did int64) (*Department, error) {
	var dept Department
	result := DB.Where("eid = ? AND did = ?", eid, did).First(&dept)
	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return nil, fmt.Errorf("department not found with ID %d", did)
		}
		return nil, result.Error
	}
	return &dept, nil
}

// GetDepartmentsByEID retrieves departments by EID and source
func GetDepartmentsByEID(eid int64, from int) ([]*Department, error) {
	var departments []*Department
	result := DB.Where(map[string]interface{}{"eid": eid, "from": from}).Order("sort DESC").Find(&departments)
	if result.Error != nil {
		return nil, result.Error
	}
	return departments, nil
}

// GetChildDepartments retrieves all child departments for a specific department
func GetChildDepartments(eid int64, pdid int64) ([]*Department, error) {
	var departments []*Department
	result := DB.Where("eid = ? AND pdid = ?", eid, pdid).Order("sort DESC").Find(&departments)
	if result.Error != nil {
		return nil, result.Error
	}
	return departments, nil
}

// BatchGetDepartmentsByIDs retrieves multiple departments by their IDs
func BatchGetDepartmentsByIDs(eid int64, dids []int64) ([]*Department, error) {
	if len(dids) == 0 {
		return []*Department{}, nil
	}

	var departments []*Department
	result := DB.Where("eid = ? AND did IN ?", eid, dids).Find(&departments)
	if result.Error != nil {
		return nil, result.Error
	}
	return departments, nil
}

// UpdateDepartment updates an existing department
func UpdateDepartment(dept *Department) error {
	if dept.DID == 0 {
		return errors.New("department ID cannot be empty")
	}
	if dept.EID == 0 {
		return errors.New("enterprise ID (EID) cannot be empty")
	}

	// Check if department exists
	existingDept, err := GetDepartmentByID(dept.EID, dept.DID)
	if err != nil {
		return fmt.Errorf("department not found: %w", err)
	}

	// Check if parent department changed
	if dept.PDID != existingDept.PDID {
		if err := handleParentChange(dept, existingDept); err != nil {
			return err
		}
	} else {
		// Keep the existing path if parent hasn't changed
		dept.Path = existingDept.Path
	}

	// Update department in database
	result := DB.Model(dept).Updates(map[string]interface{}{
		"name": dept.Name,
		"sort": dept.Sort,
	})

	return result.Error
}

// handleParentChange handles the logic when a department's parent changes
func handleParentChange(dept *Department, existingDept *Department) error {
	// Ensure no circular reference
	if dept.PDID == dept.DID {
		return errors.New("department cannot be its own parent")
	}

	// Check if new parent exists
	if dept.PDID > 0 {
		parentDept, err := GetDepartmentByID(dept.EID, dept.PDID)
		if err != nil {
			return fmt.Errorf("parent department not found: %w", err)
		}

		// Check if new parent is not a child of current department
		if isChildDepartment(parentDept.Path, dept.DID) {
			return errors.New("circular department reference detected")
		}

		// Update path
		if parentDept.Path == "" {
			dept.Path = fmt.Sprintf("%d", dept.PDID)
		} else {
			dept.Path = fmt.Sprintf("%s,%d", parentDept.Path, dept.PDID)
		}
	} else {
		// Root department
		dept.Path = ""
	}

	// Update paths of all child departments
	return updateChildDepartmentPaths(dept.EID, dept.DID, existingDept.Path, dept.Path)
}

// isChildDepartment checks if a department is a child of another department
func isChildDepartment(path string, did int64) bool {
	didStr := fmt.Sprintf("%d", did)
	return strings.Contains(path, fmt.Sprintf(",%s,", didStr)) ||
		strings.HasPrefix(path, fmt.Sprintf("%s,", didStr)) ||
		strings.HasSuffix(path, fmt.Sprintf(",%s", didStr)) ||
		path == didStr
}

// updateChildDepartmentPaths updates the paths of all child departments
func updateChildDepartmentPaths(eid int64, did int64, oldPath string, newPath string) error {
	var childDepts []*Department

	// Find all child departments
	if oldPath == "" {
		result := DB.Where("eid = ? AND (path LIKE ? OR path = ?)",
			eid, fmt.Sprintf("%d,%%", did), fmt.Sprintf("%d", did)).Find(&childDepts)
		if result.Error != nil {
			return result.Error
		}
	} else {
		result := DB.Where("eid = ? AND (path LIKE ? OR path = ?)",
			eid, fmt.Sprintf("%s,%d,%%", oldPath, did), fmt.Sprintf("%s,%d", oldPath, did)).Find(&childDepts)
		if result.Error != nil {
			return result.Error
		}
	}

	if len(childDepts) == 0 {
		return nil
	}

	// Begin transaction for batch updates
	tx := DB.Begin()
	if tx.Error != nil {
		return tx.Error
	}

	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// Update each child department's path
	for _, child := range childDepts {
		newChildPath := updateSingleChildPath(child.Path, oldPath, newPath, did)

		// Update the path
		if err := tx.Model(&Department{}).Where("eid = ? AND did = ?", eid, child.DID).
			Update("path", newChildPath).Error; err != nil {
			tx.Rollback()
			return err
		}
	}

	// Commit transaction
	return tx.Commit().Error
}

// updateSingleChildPath updates a single child department path
func updateSingleChildPath(childPath, oldPath, newPath string, did int64) string {
	var oldPrefix, newPrefix string

	if oldPath == "" {
		oldPrefix = fmt.Sprintf("%d", did)
	} else {
		oldPrefix = fmt.Sprintf("%s,%d", oldPath, did)
	}

	if newPath == "" {
		newPrefix = fmt.Sprintf("%d", did)
	} else {
		newPrefix = fmt.Sprintf("%s,%d", newPath, did)
	}

	return strings.Replace(childPath, oldPrefix, newPrefix, 1)
}

// DeleteDepartment deletes a department and optionally its children
func DeleteDepartment(eid int64, did int64, deleteChildren bool) error {
	// Check if department exists
	_, err := GetDepartmentByID(eid, did)
	if err != nil {
		return fmt.Errorf("department not found: %w", err)
	}

	// Check if department has children
	childDepts, err := GetChildDepartments(eid, did)
	if err != nil {
		return err
	}

	if len(childDepts) > 0 && !deleteChildren {
		return errors.New("department has children, cannot delete")
	}

	// Begin transaction
	tx := DB.Begin()
	if tx.Error != nil {
		return tx.Error
	}

	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	if err := tx.Where("eid = ? AND did = ?", eid, did).Delete(&MemberDepartmentRelation{}).Error; err != nil {
		tx.Rollback()
		return fmt.Errorf("failed to delete member-department relations: %w", err)
	}

	if deleteChildren && len(childDepts) > 0 {
		var childDIDs []int64
		for _, child := range childDepts {
			childDIDs = append(childDIDs, child.DID)
		}

		if err := tx.Where("eid = ? AND did IN ?", eid, childDIDs).Delete(&MemberDepartmentRelation{}).Error; err != nil {
			tx.Rollback()
			return fmt.Errorf("failed to delete child member-department relations: %w", err)
		}

		if err := tx.Where("eid = ? AND did IN ?", eid, childDIDs).Delete(&Department{}).Error; err != nil {
			tx.Rollback()
			return err
		}
	}

	// Delete the department
	if err := tx.Where("eid = ? AND did = ?", eid, did).Delete(&Department{}).Error; err != nil {
		tx.Rollback()
		return err
	}

	// Commit transaction
	return tx.Commit().Error
}

// BatchDeleteDepartments deletes multiple departments
func BatchDeleteDepartments(eid int64, dids []int64) error {
	if len(dids) == 0 {
		return nil
	}

	tx := DB.Begin()
	if tx.Error != nil {
		return tx.Error
	}

	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	if err := tx.Where("eid = ? AND did IN ?", eid, dids).Delete(&Department{}).Error; err != nil {
		tx.Rollback()
		return err
	}

	return tx.Commit().Error
}

// SearchDepartments searches for departments by name
func SearchDepartments(eid int64, keyword string, limit int) ([]*Department, error) {
	var departments []*Department

	query := DB.Where("eid = ?", eid)

	if keyword != "" {
		query = query.Where("name LIKE ?", "%"+keyword+"%")
	}

	if limit > 0 {
		query = query.Limit(limit)
	}

	result := query.Order("sort DESC").Find(&departments)
	if result.Error != nil {
		return nil, result.Error
	}

	return departments, nil
}

// GetDepartmentTree returns a hierarchical structure of departments
func GetDepartmentTree(eid int64, from int) ([]*DepartmentNode, error) {
	// Get all departments for the enterprise
	allDepts, err := GetDepartmentsByEID(eid, from)
	if err != nil {
		return nil, err
	}

	if len(allDepts) == 0 {
		return []*DepartmentNode{}, nil
	}

	// Create a map of departments by ID
	deptMap := make(map[int64]*Department, len(allDepts))
	for _, dept := range allDepts {
		deptMap[dept.DID] = dept
	}

	// Create root nodes (departments with no parent)
	var rootNodes []*DepartmentNode

	// Build the tree
	for _, dept := range allDepts {
		if dept.PDID == 0 {
			// This is a root department
			node := &DepartmentNode{
				Department: dept,
				Children:   make([]*DepartmentNode, 0),
			}
			rootNodes = append(rootNodes, node)
		}
	}

	// Sort root nodes by sort order
	sortDepartmentNodes(rootNodes)

	// Build children for each root node
	for _, rootNode := range rootNodes {
		buildDepartmentTree(rootNode, allDepts, deptMap)
	}

	return rootNodes, nil
}

// DepartmentNode represents a node in the department hierarchy
type DepartmentNode struct {
	Department *Department       `json:"department"`
	Children   []*DepartmentNode `json:"children"`
}

// buildDepartmentTree recursively builds the department tree
func buildDepartmentTree(node *DepartmentNode, allDepts []*Department, deptMap map[int64]*Department) {
	for _, dept := range allDepts {
		if dept.PDID == node.Department.DID {
			childNode := &DepartmentNode{
				Department: dept,
				Children:   make([]*DepartmentNode, 0),
			}
			node.Children = append(node.Children, childNode)
			buildDepartmentTree(childNode, allDepts, deptMap)
		}
	}

	// Sort children by sort order
	sortDepartmentNodes(node.Children)
}

// sortDepartmentNodes sorts department nodes by sort order
func sortDepartmentNodes(nodes []*DepartmentNode) {
	for i := 0; i < len(nodes)-1; i++ {
		for j := i + 1; j < len(nodes); j++ {
			if nodes[i].Department.Sort < nodes[j].Department.Sort {
				nodes[i], nodes[j] = nodes[j], nodes[i]
			}
		}
	}
}
