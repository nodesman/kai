#ifndef DIFFVIEW_H
#define DIFFVIEW_H

#include <QWidget>
#include <QList>
#include <QScopedPointer>
#include <QListView>
#include <QScrollArea>
#include <QModelIndex>

class DiffModel;
class DiffContentWidget;

class DiffView : public QWidget {
    Q_OBJECT

public:
    DiffView(QWidget *parent = nullptr, DiffModel *model = nullptr); // Constructor
    ~DiffView();

    void setModel(DiffModel *model);  // For changing the model after construction
    void modelWasReset();

    struct DiffLine { // Moved struct to public
        enum ChangeType {
            Added,
            Removed,
            Unchanged
        };

        ChangeType changeType;
        QString text;
        int originalLineNumber; // Optional, as you had it before, but not used in current parsing
        int modifiedLineNumber;  // Optional
    };

    signals:
        void requestDiffExplanation();

    private slots:
        void onFileSelectionChanged(const QModelIndex &index);
    void onDataChanged(const QModelIndex &topLeft, const QModelIndex &bottomRight, const QVector<int> &roles = QVector<int>()); // For dynamic updates
    void updateDiffContent(); // Helper function

private:
    DiffModel *m_model;
    QListView *m_fileListView;
    QScrollArea *m_scrollArea;
    QScopedPointer<DiffContentWidget> m_diffContent;
    int m_lineHeight;
    QModelIndex m_currentIndex; // Keep track of the currently selected index

    QList<DiffLine> parseDiffContent(const QString& content); // Moved here
    void mousePressEvent(QMouseEvent *event) override;
};

#endif // DIFFVIEW_H