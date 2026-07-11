package service

import (
	"github.com/53AI/53AIHub/model"
)

func GetSubjectIdentifierByUser(Eid int64, UserId int64) (subjects []model.SubjectIdentifier, err error) {
	user, err := model.GetUserByID(UserId)
	if err != nil {
		return nil, err
	}

	subjects = append(subjects, model.SubjectIdentifier{
		SubjectType: model.SUBJECT_TYPE_USER,
		SubjectID:   UserId,
	})

	groups, _ := user.GetUserGroupIds()
	for _, groupID := range groups {
		subjects = append(subjects, model.SubjectIdentifier{
			SubjectType: model.SUBJECT_TYPE_GROUP,
			SubjectID:   groupID,
		})
	}

	subjects = append(subjects, model.SubjectIdentifier{
		SubjectType: model.SUBJECT_TYPE_COMPANY_ALL,
		SubjectID:   0,
	})
	return subjects, nil
}

// GetUserGroupIDs 获取用户所在分组ID集合
func GetUserGroupIDs(userID int64) ([]int64, error) {
	u, err := model.GetUserByID(userID)
	if err != nil {
		return nil, err
	}
	if u == nil {
		return []int64{}, nil
	}
	groups, _ := u.GetUserGroupIds()
	return groups, nil
}
