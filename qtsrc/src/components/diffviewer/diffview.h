// diffview.h
#ifndef DIFFVIEW_H
#define DIFFVIEW_H

#include <QWidget>
#include <QList>
#include <QScopedPointer> // Use QScopedPointer

class QListView;
class QScrollArea;
class DiffModel;
class DiffContentWidget; // Forward declare
class QPaintEvent;

class DiffView : public QWidget {
    Q_OBJECT

public:
    struct DiffLine {
        enum ChangeType {
            Unchanged,
            Added,
            Removed
        } changeType;
        QString text;
        int originalLineNumber;
        int modifiedLineNumber;
    };

    DiffView(QWidget *parent = nullptr);
    ~DiffView();

    void setModel(DiffModel *model);

    signals:
        void requestDiffExplanation();

    private slots:
        void onFileSelectionChanged(const QModelIndex &index);
    //void onScrollValueChanged(int value); // No longer needed

private:

    QList<DiffLine> parseDiffContent(const QString& content);


    void mousePressEvent(QMouseEvent *event);


    DiffModel *m_model;
    QListView *m_fileListView;
    QScrollArea *m_scrollArea;
    QScopedPointer<DiffContentWidget> m_diffContent; // Use smart pointer!
    int m_lineHeight;  // Store line height
};

#endif // DIFFVIEW_H