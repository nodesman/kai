// diffmodel.cpp
#include "diffmodel.h"

DiffModel::DiffModel(QObject *parent)
    : QAbstractListModel(parent)
{
}

int DiffModel::rowCount(const QModelIndex &parent) const
{
    if (parent.isValid())
        return 0;

    return m_filePaths.count();
}

QVariant DiffModel::data(const QModelIndex &index, int role) const
{
    if (!index.isValid() || index.row() >= m_filePaths.count())
        return QVariant();

    if (role == Qt::DisplayRole) {
        return m_filePaths.at(index.row()); // Display the file path
    }

    return QVariant(); // Return an invalid QVariant for other roles
}

void DiffModel::setFiles(const QStringList& filePaths, const QList<QString>& fileContents)
{
    beginResetModel(); // Important: Notify views about the change
    m_filePaths = filePaths;
    m_fileContents = fileContents; // Store the content
    endResetModel(); // Important: Notify views about the change
}

QString DiffModel::getFileContent(int index) const
{
    if (index >= 0 && index < m_fileContents.count()) {
        return m_fileContents.at(index);
    }
    return QString(); // Return empty string if index is invalid
}