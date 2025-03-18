// diffmodel.h
#ifndef DIFFMODEL_H
#define DIFFMODEL_H

#include <QAbstractListModel>
#include <QStringList>

class DiffModel : public QAbstractListModel {
    Q_OBJECT

public:
    explicit DiffModel(QObject *parent = nullptr);

    // QAbstractItemModel interface
    int rowCount(const QModelIndex &parent = QModelIndex()) const override;
    QVariant data(const QModelIndex &index, int role = Qt::DisplayRole) const override;

    // Custom methods to set and get data
    void setFiles(const QStringList& filePaths, const QList<QString>& fileContents);
    QString getFileContent(int index) const;

private:
    QStringList m_filePaths;
    QList<QString> m_fileContents; // Store the *full, colorized* content for each file
};

#endif // DIFFMODEL_H